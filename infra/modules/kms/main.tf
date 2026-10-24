locals {
  root_arn       = "arn:aws:iam::${var.account_id}:root"
  administrators = distinct(concat([var.provisioner_arn], var.administrator_arns))
  users          = distinct(concat([var.provisioner_arn], var.key_user_arns))
  allowed_arns   = distinct(concat([local.root_arn], local.administrators, local.users))
  # Resource "*" em key policy significa somente a chave à qual a policy pertence.
  administration_actions = [
    "kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:ListKeyPolicies",
    "kms:EnableKey", "kms:DisableKey", "kms:UpdateKeyDescription",
    "kms:EnableKeyRotation", "kms:DisableKeyRotation", "kms:GetKeyRotationStatus",
    "kms:RotateKeyOnDemand", "kms:ListKeyRotations",
    "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
    "kms:TagResource", "kms:UntagResource", "kms:ListResourceTags",
    "kms:CreateAlias", "kms:UpdateAlias", "kms:DeleteAlias", "kms:ListGrants", "kms:RevokeGrant"
  ]
  crypto_actions = [
    "kms:Encrypt", "kms:Decrypt", "kms:ReEncryptFrom", "kms:ReEncryptTo",
    "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"
  ]
  # JSON nas alternativas mantém os tipos heterogêneos dos operadores IAM.
  user_conditions = jsondecode(length(var.s3_bucket_arns) > 0 ? jsonencode({
    StringEquals = { "kms:ViaService" = "s3.${var.aws_region}.amazonaws.com" }
    ArnLike      = { "kms:EncryptionContext:aws:s3:arn" = concat(var.s3_bucket_arns, [for arn in var.s3_bucket_arns : "${arn}/*"]) }
    }) : length(var.sns_topic_arns) > 0 ? jsonencode({
    StringEquals = {
      "kms:ViaService"                         = "sns.${var.aws_region}.amazonaws.com"
      "kms:EncryptionContext:aws:sns:topicArn" = var.sns_topic_arns
    }
  }) : "{}")
  policy = {
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid       = "PreserveAccountRecoveryAndIAMDelegation"
        Effect    = "Allow"
        Principal = { AWS = local.root_arn }
        Action    = local.administration_actions
        Resource  = "*"
        # A delegação IAM não amplia o perímetro de principais autorizado abaixo.
      },
      {
        Sid       = "RootRecoveryCryptography"
        Effect    = "Allow"
        Principal = { AWS = local.root_arn }
        Action    = local.crypto_actions
        Resource  = "*"
        Condition = { ArnEquals = { "aws:PrincipalArn" = local.root_arn } }
      },
      {
        Sid    = "ExplicitKeyAdministrators"
        Effect = "Allow"
        # A conta delega via IAM; condicao aceita roles futuras sem Principal invalido.
        Principal = { AWS = local.root_arn }
        Action    = local.administration_actions
        Resource  = "*"
        Condition = { ArnEquals = { "aws:PrincipalArn" = local.administrators } }
      },
      merge({
        Sid       = "ExplicitKeyUsers"
        Effect    = "Allow"
        Principal = { AWS = local.root_arn }
        Action    = local.crypto_actions
        Resource  = "*"
        Condition = merge(local.user_conditions, { ArnEquals = { "aws:PrincipalArn" = local.users } })
      }),
      {
        Sid       = "DenyPrincipalsOutsideAllowlist"
        Effect    = "Deny"
        Principal = "*"
        # Curinga somente em Deny para cobrir também ações futuras e grants.
        Action   = "kms:*"
        Resource = "*"
        Condition = {
          ArnNotEquals = { "aws:PrincipalArn" = local.allowed_arns }
          Bool         = { "aws:PrincipalIsAWSService" = "false" }
        }
      }
      ], length(var.cloudwatch_log_group_arns) == 0 ? [] : [
      {
        Sid       = "CloudWatchLogsForExplicitGroups"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.aws_region}.amazonaws.com" }
        Action    = local.crypto_actions
        Resource  = "*"
        # Contexto contém conta/região e é documentado pelo CloudWatch Logs.
        Condition = { ArnEquals = { "kms:EncryptionContext:aws:logs:arn" = var.cloudwatch_log_group_arns } }
      }
      ], [for source in [
        { sid = "CloudWatchAlarmPublishers", service = "cloudwatch.amazonaws.com", arns = var.cloudwatch_alarm_arns },
        { sid = "BudgetPublishers", service = "budgets.amazonaws.com", arns = var.budget_arns }
        ] : {
        Sid       = source.sid
        Effect    = "Allow"
        Principal = { Service = source.service }
        Action    = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = var.account_id }
          ArnLike      = { "aws:SourceArn" = source.arns }
        }
    } if length(source.arns) > 0])
  }
}

resource "aws_kms_key" "this" {
  description             = "Chave dedicada ${var.name_prefix}"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = jsonencode(local.policy)
  tags                    = var.tags

  lifecycle {
    precondition {
      condition     = !(length(var.s3_bucket_arns) > 0 && length(var.sns_topic_arns) > 0)
      error_message = "Instancie chaves distintas para S3 e SNS; não misture contextos de usuários."
    }
    precondition {
      condition     = (length(var.cloudwatch_alarm_arns) == 0 && length(var.budget_arns) == 0) || length(var.sns_topic_arns) > 0
      error_message = "Publicadores CloudWatch/Budgets exigem tópicos SNS explícitos."
    }
  }
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name_prefix}"
  target_key_id = aws_kms_key.this.key_id
}
