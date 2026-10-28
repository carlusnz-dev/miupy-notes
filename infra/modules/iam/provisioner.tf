locals {
  environment_bucket_arns = concat([var.app_bucket_arn], sort(tolist(var.additional_bucket_arns)))
  provisioner_statements = concat([
    {
      Sid       = "CreateRuntimeWithFixedBoundary", Effect = "Allow", Action = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"],
      Resource  = [local.role_arns.api],
      Condition = { StringEquals = { "iam:PermissionsBoundary" = local.boundary_arn } }
    },
    {
      Sid      = "ManageRuntimeOnly", Effect = "Allow",
      Action   = ["iam:GetRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags"],
      Resource = [local.role_arns.api]
    },
    {
      Sid       = "PassOnlyRuntimeToLambda", Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.role_arns.api],
      Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
    },
    {
      Sid      = "ReadProtectedIAMForRefresh", Effect = "Allow",
      Action   = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListRoleTags", "iam:GetUser", "iam:ListGroupsForUser", "iam:GetGroup", "iam:GetGroupPolicy", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"],
      Resource = concat(values(local.role_arns), [local.boundary_arn], [for key in keys(local.human_roles) : "${local.iam_prefix}:user${local.path}${var.name_prefix}-${key}"], [for key in keys(local.human_roles) : "${local.iam_prefix}:group${local.path}${var.name_prefix}-${key}"])
    },
    {
      Sid = "EnvironmentBuckets", Effect = "Allow",
      Action = ["s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:GetBucketVersioning", "s3:PutBucketVersioning", "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock", "s3:GetBucketOwnershipControls", "s3:PutBucketOwnershipControls", "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration", "s3:GetBucketLogging", "s3:PutBucketLogging", "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:GetMetricsConfiguration", "s3:PutMetricsConfiguration", "s3:ListBucket",
        # Leituras que o provider faz a cada refresh de aws_s3_bucket (sem elas o plan falha com 403).
      "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketWebsite", "s3:GetBucketRequestPayment", "s3:GetBucketObjectLockConfiguration", "s3:GetReplicationConfiguration"],
      Resource = local.environment_bucket_arns
    },
    {
      Sid      = "EnvironmentLogs", Effect = "Allow",
      Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:DisassociateKmsKey", "logs:PutMetricFilter", "logs:DeleteMetricFilter", "logs:DescribeMetricFilters", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource"],
      Resource = concat(local.log_group_arns, [for arn in local.log_group_arns : "${arn}:*"])
    },
    {
      Sid      = "EnvironmentAlarms", Effect = "Allow",
      Action   = ["cloudwatch:PutMetricAlarm", "cloudwatch:PutCompositeAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:EnableAlarmActions", "cloudwatch:DisableAlarmActions", "cloudwatch:TagResource", "cloudwatch:UntagResource", "cloudwatch:ListTagsForResource"],
      Resource = [for region in distinct([var.aws_region, "us-east-1"]) : "arn:aws:cloudwatch:${region}:${var.account_id}:alarm:${var.name_prefix}-*"]
    },
    {
      Sid      = "EnvironmentDashboard", Effect = "Allow", Action = ["cloudwatch:GetDashboard", "cloudwatch:PutDashboard", "cloudwatch:DeleteDashboards"],
      Resource = ["arn:aws:cloudwatch::${var.account_id}:dashboard/${var.name_prefix}-*"]
    },
    {
      Sid      = "EnvironmentAlerts", Effect = "Allow",
      Action   = ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:Subscribe", "sns:ListSubscriptionsByTopic", "sns:TagResource", "sns:UntagResource", "sns:ListTagsForResource"],
      Resource = [for region in distinct([var.aws_region, "us-east-1"]) : "arn:aws:sns:${region}:${var.account_id}:${var.name_prefix}-*"]
    },
    {
      # SNS autoriza operacoes de assinatura pelo ARN do topico.
      Sid      = "EnvironmentSubscriptions", Effect = "Allow",
      Action   = ["sns:GetSubscriptionAttributes", "sns:Unsubscribe"],
      Resource = [for region in distinct([var.aws_region, "us-east-1"]) : "arn:aws:sns:${region}:${var.account_id}:${var.name_prefix}-*"]
    },
    {
      Sid      = "EnvironmentBudget", Effect = "Allow",
      Action   = ["budgets:ViewBudget", "budgets:ModifyBudget", "budgets:TagResource", "budgets:UntagResource", "budgets:ListTagsForResource"],
      Resource = ["arn:aws:budgets::${var.account_id}:budget/${var.name_prefix}-*"]
    },
    {
      Sid      = "EnvironmentLambda", Effect = "Allow",
      Action   = ["lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:PublishVersion", "lambda:ListVersionsByFunction", "lambda:GetPolicy", "lambda:AddPermission", "lambda:RemovePermission", "lambda:CreateAlias", "lambda:UpdateAlias", "lambda:DeleteAlias", "lambda:GetAlias", "lambda:ListAliases", "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags", "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency", "lambda:GetFunctionConcurrency"],
      Resource = [local.lambda_arn, "${local.lambda_arn}:*"]
    },
    {
      # HTTP API v2 não tem ARN por nome; o escopo é a região, apenas /apis e tags. A conta só hospeda esta API.
      Sid      = "EnvironmentHttpApi", Effect = "Allow",
      Action   = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"],
      Resource = ["arn:aws:apigateway:${var.aws_region}::/apis", "arn:aws:apigateway:${var.aws_region}::/apis/*", "arn:aws:apigateway:${var.aws_region}::/tags/*"]
    },
    {
      Sid      = "EnvironmentTables", Effect = "Allow",
      Action   = ["dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:UpdateTable", "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource"],
      Resource = [local.table_arn]
    },
    {
      # Métricas/grupos não suportam ARN; DescribeAlarms exige * para alarmes compostos.
      Sid      = "RegionalDiscovery", Effect = "Allow",
      Action   = ["logs:DescribeLogGroups", "cloudwatch:DescribeAlarms", "cloudwatch:ListMetrics", "cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics"],
      Resource = ["*"], Condition = { StringEquals = { "aws:RequestedRegion" = distinct([var.aws_region, "us-east-1"]) } }
    }
    ], jsondecode(var.backend_bucket_arn == null ? "[]" : jsonencode([
      {
        Sid       = "BackendListExactKeys", Effect = "Allow", Action = ["s3:ListBucket"], Resource = [var.backend_bucket_arn],
        Condition = { StringEquals = { "s3:prefix" = [var.backend_state_key, "${var.backend_state_key}.tflock"] } }
      },
      { Sid = "BackendState", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${var.backend_bucket_arn}/${var.backend_state_key}"] },
      { Sid = "BackendLock", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["${var.backend_bucket_arn}/${var.backend_state_key}.tflock"] }
  ])))
}
resource "aws_iam_role_policy" "provisioner" {
  name   = "${var.name_prefix}-provision"
  role   = aws_iam_role.human["admin"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.provisioner_statements })
}
