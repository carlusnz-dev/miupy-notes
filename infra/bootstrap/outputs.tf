output "state_bucket_name" {
  description = "Nome do bucket a usar na configuração local do backend."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "ARN do bucket para policies do backend."
  value       = aws_s3_bucket.state.arn
}

output "state_kms_key_arn" {
  description = "ARN da chave SSE-KMS para o backend e suas policies."
  value       = aws_kms_key.state.arn
}
