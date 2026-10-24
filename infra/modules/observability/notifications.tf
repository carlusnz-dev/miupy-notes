locals {
  cross_region_billing = var.aws_region != "us-east-1"
  billing_topic_arn    = local.cross_region_billing ? aws_sns_topic.billing[0].arn : aws_sns_topic.alerts.arn
  budget_name          = "${var.name_prefix}-total-monthly"
}

resource "aws_sns_topic" "alerts" {
  name              = "${var.name_prefix}-alerts"
  kms_master_key_id = var.kms_key_arn
  tags              = var.tags

  lifecycle {
    precondition {
      condition     = startswith(var.kms_key_arn, "arn:aws:kms:${var.aws_region}:${var.account_id}:key/")
      error_message = "A chave de logs/SNS deve pertencer à conta e região da aplicação."
    }
  }
}

resource "aws_sns_topic" "billing" {
  count             = local.cross_region_billing ? 1 : 0
  provider          = aws.billing
  name              = "${var.name_prefix}-billing-alerts"
  kms_master_key_id = var.billing_kms_key_arn
  tags              = var.tags

  lifecycle {
    precondition {
      condition     = var.billing_kms_key_arn != null && try(startswith(var.billing_kms_key_arn, "arn:aws:kms:us-east-1:${var.account_id}:key/"), false)
      error_message = "Billing fora da região da aplicação exige billing_kms_key_arn da conta em us-east-1."
    }
  }
}

locals {
  topic_policies = {
    app = {
      arn    = aws_sns_topic.alerts.arn
      region = var.aws_region
    }
    billing = {
      arn    = local.billing_topic_arn
      region = "us-east-1"
    }
  }
  # Somente os serviços publicam; administração/assinatura vêm das policies IAM.
  sns_policies = {
    for key, topic in local.topic_policies : key => jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid       = "CloudWatchFromThisEnvironment"
          Effect    = "Allow"
          Principal = { Service = "cloudwatch.amazonaws.com" }
          Action    = "sns:Publish"
          Resource  = topic.arn
          Condition = {
            StringEquals = { "aws:SourceAccount" = var.account_id }
            ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:${topic.region}:${var.account_id}:alarm:${var.name_prefix}-*" }
          }
        },
        {
          Sid       = "BudgetFromThisAccount"
          Effect    = "Allow"
          Principal = { Service = "budgets.amazonaws.com" }
          Action    = "sns:Publish"
          Resource  = topic.arn
          Condition = {
            StringEquals = { "aws:SourceAccount" = var.account_id }
            ArnLike      = { "aws:SourceArn" = "arn:aws:budgets::${var.account_id}:budget/${local.budget_name}" }
          }
        }
      ]
    })
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = local.sns_policies.app
}

resource "aws_sns_topic_policy" "billing" {
  count    = local.cross_region_billing ? 1 : 0
  provider = aws.billing
  arn      = local.billing_topic_arn
  policy   = local.sns_policies.billing
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_subscription" "billing_email" {
  count     = local.cross_region_billing ? 1 : 0
  provider  = aws.billing
  topic_arn = local.billing_topic_arn
  protocol  = "email"
  endpoint  = var.alert_email
}
