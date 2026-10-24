output "key_arn" {
  description = "ARN da chave para IAM e recursos cifrados."
  value       = aws_kms_key.this.arn
}

output "key_id" {
  description = "ID público da chave, sem material criptográfico."
  value       = aws_kms_key.this.key_id
}

output "alias_name" {
  description = "Alias determinístico da finalidade."
  value       = aws_kms_alias.this.name
}
