mock_provider "aws" {
  override_during = plan
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::miupy-test-000000000000-mock" }
  }
}

variables {
  name_prefix     = "miupy-test"
  account_id      = "000000000000"
  aws_region      = "us-east-1"
  tags            = {}
  provisioner_arn = "arn:aws:iam::000000000000:role/miupy-test/miupy-test-provisioner"
}

run "tls_and_sse_s3" {
  command = plan
  assert {
    condition     = alltrue([for key, policy in aws_s3_bucket_policy.this : alltrue([for sid in ["DenyInsecureTransport", "DenyOldTLS", "DenyExplicitNonSSES3"] : contains([for s in jsondecode(policy.policy).Statement : s.Sid], sid)])])
    error_message = "Todos os buckets negam transporte sem TLS, TLS < 1.2 e modo SSE explícito diferente de AES256."
  }
  assert {
    condition     = alltrue([for key, policy in aws_s3_bucket_policy.this : [for s in jsondecode(policy.policy).Statement : s.Condition.Bool["aws:SecureTransport"] if s.Sid == "DenyInsecureTransport"][0] == "false"])
    error_message = "O deny de transporte atua em aws:SecureTransport = false."
  }
  assert {
    condition     = alltrue([for key, policy in aws_s3_bucket_policy.this : [for s in jsondecode(policy.policy).Statement : s.Condition.NumericLessThan["s3:TlsVersion"] if s.Sid == "DenyOldTLS"][0] == "1.2"])
    error_message = "O deny de TLS antigo atua abaixo de 1.2."
  }
  assert {
    condition     = alltrue([for key, config in aws_s3_bucket_server_side_encryption_configuration.this : one(config.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])
    error_message = "Os buckets usam SSE-S3 (AES256)."
  }
}
