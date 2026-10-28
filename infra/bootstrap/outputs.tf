output "state_bucket_name" {
  description = "Nome do bucket a usar na configuração local do backend."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "ARN do bucket para policies do backend."
  value       = aws_s3_bucket.state.arn
}
