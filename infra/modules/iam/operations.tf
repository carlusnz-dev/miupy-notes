locals {
  monitoring_statements = [
    {
      Sid      = "EnvironmentLogs", Effect = "Allow",
      Action   = ["logs:DescribeLogStreams", "logs:GetLogEvents", "logs:FilterLogEvents", "logs:ListTagsForResource"],
      Resource = concat(local.log_group_arns, [for arn in local.log_group_arns : "${arn}:*"])
    },
    {
      # Métricas/listagem de grupos não suportam ARN; DescribeAlarms exige * para alarmes compostos.
      Sid      = "RegionalMetricsRead", Effect = "Allow",
      Action   = ["cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics", "cloudwatch:DescribeAlarms", "logs:DescribeLogGroups"],
      Resource = ["*"], Condition = { StringEquals = { "aws:RequestedRegion" = var.aws_region } }
    },
    {
      Sid      = "EnvironmentDashboard", Effect = "Allow", Action = ["cloudwatch:GetDashboard"],
      Resource = ["arn:aws:cloudwatch::${var.account_id}:dashboard/${var.name_prefix}-*"]
    }
  ]
  operator_statements = concat(local.monitoring_statements, [
    {
      Sid      = "InspectLambda", Effect = "Allow",
      Action   = ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:ListVersionsByFunction", "lambda:ListAliases", "lambda:GetPolicy", "lambda:ListTags"],
      Resource = [local.lambda_arn, "${local.lambda_arn}:*"]
    },
    {
      # Redefinir a concorrência permite pausar/retomar a função; Lambda não tem RestartFunction.
      Sid    = "PauseResumeLambda", Effect = "Allow",
      Action = ["lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency", "lambda:GetFunctionConcurrency"], Resource = [local.lambda_arn]
    },
    {
      # DynamoDB é gerenciado; não existe operação de reinício de tabela.
      Sid    = "InspectTables", Effect = "Allow",
      Action = ["dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource"], Resource = [local.table_arn]
    }
    ], jsondecode(length(var.operator_s3_prefixes) == 0 ? "[]" : jsonencode([
      {
        Sid      = "OperatorObjects", Effect = "Allow",
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
        Resource = [for p in sort(tolist(var.operator_s3_prefixes)) : "${var.app_bucket_arn}/${p}*"]
      },
      {
        Sid       = "ListApprovedPrefixes", Effect = "Allow", Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = [var.app_bucket_arn],
        Condition = { StringLike = { "s3:prefix" = [for p in sort(tolist(var.operator_s3_prefixes)) : "${p}*"] } }
      },
      {
        Sid       = "ObjectEncryptionViaS3", Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = [var.app_kms_key_arn],
        Condition = { StringEquals = { "kms:ViaService" = "s3.${var.aws_region}.amazonaws.com", "kms:EncryptionContext:aws:s3:arn" = var.app_bucket_arn } }
      }
  ])))
  monitor_statements = concat(local.monitoring_statements, [
    {
      Sid      = "AccountBudgetRead", Effect = "Allow", Action = ["budgets:ViewBudget"],
      Resource = ["arn:aws:budgets::${var.account_id}:budget/*"]
    },
    {
      # Cost Explorer e métricas de billing são consultas agregadas sem ARN; endpoint us-east-1.
      Sid      = "AccountCostRead", Effect = "Allow",
      Action   = ["ce:GetCostAndUsage", "ce:GetCostForecast", "ce:GetDimensionValues", "ce:GetTags", "cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics", "cloudwatch:DescribeAlarms"],
      Resource = ["*"], Condition = { StringEquals = { "aws:RequestedRegion" = "us-east-1" } }
    }
  ])
}
resource "aws_iam_role_policy" "operator" {
  name   = "${var.name_prefix}-operations"
  role   = aws_iam_role.human["operator"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.operator_statements })
}
resource "aws_iam_role_policy" "monitor" {
  name   = "${var.name_prefix}-monitoring"
  role   = aws_iam_role.human["monitor"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.monitor_statements })
}
