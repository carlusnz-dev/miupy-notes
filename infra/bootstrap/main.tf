provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = merge(var.tags, { Project = "miupy-notes", ManagedBy = "Terraform", Purpose = "terraform-state" })
  }
}

# A chave KMS do estado sai do código mas continua na conta: destroy = false evita agendar a exclusão enquanto
# versões antigas do estado ainda estão cifradas com ela. A exclusão é manual e posterior
# (docs/decisoes/2026-10-27_kms-gerenciado-aws.md). Remova estes blocos depois do apply.
removed {
  from = aws_kms_key.state
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_kms_alias.state
  lifecycle {
    destroy = false
  }
}

resource "aws_s3_bucket" "state" {
  bucket        = var.state_bucket_name
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3: sem chave própria nem custo por request. O backend S3 com encrypt = true envia AES256.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket     = aws_s3_bucket.state.id
  depends_on = [aws_s3_bucket_versioning.state]
  rule {
    id     = "reter-historico-e-limpar-uploads-incompletos"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_days
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  depends_on = [aws_s3_bucket_public_access_block.state]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        # Curinga apenas no Deny: não concede operações ao bucket ou aos objetos.
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyLegacyTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { NumericLessThan = { "s3:TlsVersion" = "1.2" } }
      },
      {
        Sid       = "DenyExplicitNonSSES3"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.state.arn}/*"
        # A criptografia padrão aplica AES256; barra só quem pede explicitamente outro modo (ex.: aws:kms).
        Condition = {
          Null            = { "s3:x-amz-server-side-encryption" = "false" }
          StringNotEquals = { "s3:x-amz-server-side-encryption" = "AES256" }
        }
      }
    ]
  })
}
