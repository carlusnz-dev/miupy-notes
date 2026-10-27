output "human_user_names" { value = module.iam.human_user_names }
output "role_arns" { value = module.iam.role_arns }
output "app_bucket_name" { value = module.storage.bucket_name }
output "access_logs_bucket_name" { value = module.storage.access_logs_bucket_name }
output "kms_key_arns" { value = merge({ objects = module.objects_key.key_arn, data = module.data_key.key_arn, observability = module.observability_key.key_arn }, var.aws_region == "us-east-1" ? {} : { billing = module.billing_key[0].key_arn }) }
output "data_table_name" { value = aws_dynamodb_table.data.name }
output "http_api_endpoint" { value = aws_apigatewayv2_api.this.api_endpoint }
output "alert_topic_arn" { value = module.observability.alert_topic_arn }
output "billing_topic_arn" { value = module.observability.billing_alert_topic_arn }
output "log_group_names" { value = module.observability.log_group_names }
output "dashboard_name" { value = module.observability.dashboard_name }
