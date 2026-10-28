output "bucket_name" {
  description = "Nome determinístico do bucket do app."
  value       = aws_s3_bucket.this["app"].id
}

output "bucket_arn" {
  description = "ARN do bucket do app para policies IAM."
  value       = aws_s3_bucket.this["app"].arn
}

output "access_logs_bucket_name" {
  description = "Nome do destino separado de logs S3."
  value       = aws_s3_bucket.this["access_logs"].id
}

output "access_logs_bucket_arn" {
  description = "ARN do destino separado de logs S3."
  value       = aws_s3_bucket.this["access_logs"].arn
}
