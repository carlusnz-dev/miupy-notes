locals {
  app_name        = "${var.name_prefix}-${var.account_id}-app"
  logs_name       = "${var.name_prefix}-${var.account_id}-access-logs"
  root_arn        = "arn:aws:iam::${var.account_id}:root"
  allowed_arns    = distinct(concat([local.root_arn, var.provisioner_arn], var.allowed_principal_arns))
  bucket_names    = { app = local.app_name, access_logs = local.logs_name }
  short_retention = { exports = var.exports_retention_days, imports = var.imports_retention_days, "tmp/uploads" = var.tmp_retention_days }
}

resource "aws_s3_bucket" "this" {
  for_each      = local.bucket_names
  bucket        = each.value
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.bucket_names
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (chave gerenciada pelo S3) nos dois buckets: sem custo por request e sem dependência de chave própria.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.app
  to   = aws_s3_bucket_server_side_encryption_configuration.this["app"]
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.access_logs
  to   = aws_s3_bucket_server_side_encryption_configuration.this["access_logs"]
}

resource "aws_s3_bucket_policy" "this" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.this[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        # Curingas somente em Deny, abrangendo bucket/objetos deste ambiente.
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false", "aws:PrincipalIsAWSService" = "false" } }
      },
      {
        Sid       = "DenyOldTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
        Condition = {
          NumericLessThan = { "s3:TlsVersion" = "1.2" }
          Bool            = { "aws:PrincipalIsAWSService" = "false" }
        }
      },
      {
        Sid       = "DenyPrincipalsOutsideAllowlist"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
        Condition = merge(
          { ArnNotEquals = { "aws:PrincipalArn" = local.allowed_arns } },
          # Apenas o bucket de logs aceita principal de serviço, por Allow exato abaixo.
          each.key == "access_logs" ? { Bool = { "aws:PrincipalIsAWSService" = "false" } } : {}
        )
      },
      {
        Sid       = "DenyExplicitNonSSES3"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.this[each.key].arn}/*"
        # A criptografia padrão aplica AES256; o deny só barra quem pede explicitamente outro modo (aws:kms, dsse).
        # A entrega de access logs não envia o header e continua válida.
        Condition = {
          Null            = { "s3:x-amz-server-side-encryption" = "false" }
          StringNotEquals = { "s3:x-amz-server-side-encryption" = "AES256" }
        }
      }
      ], [for statement in [
        {
          Sid       = "AllowS3AccessLogDelivery"
          Effect    = "Allow"
          Principal = { Service = "logging.s3.amazonaws.com" }
          Action    = "s3:PutObject"
          Resource  = "${aws_s3_bucket.this[each.key].arn}/logs/*"
          Condition = {
            StringEquals = { "aws:SourceAccount" = var.account_id }
            ArnEquals    = { "aws:SourceArn" = aws_s3_bucket.this["app"].arn }
          }
        }
    ] : statement if each.key == "access_logs"])
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_s3_bucket_logging" "app" {
  bucket        = aws_s3_bucket.this["app"].id
  target_bucket = aws_s3_bucket.this["access_logs"].id
  target_prefix = "logs/"
  depends_on = [
    aws_s3_bucket_policy.this,
    aws_s3_bucket_ownership_controls.this,
    aws_s3_bucket_server_side_encryption_configuration.this
  ]
}

resource "aws_s3_bucket_metric" "requests" {
  count  = var.enable_request_metrics ? 1 : 0
  bucket = aws_s3_bucket.this["app"].id
  name   = "EntireBucket"
}

resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket = aws_s3_bucket.this["app"].id
  rule {
    id     = "multipart-and-old-versions"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_retention_days
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
  dynamic "rule" {
    for_each = local.short_retention
    content {
      id     = "expire-${replace(rule.key, "/", "-")}"
      status = "Enabled"
      filter {
        prefix = "${rule.key}/"
      }
      expiration {
        days = rule.value
      }
      noncurrent_version_expiration {
        noncurrent_days = rule.value
      }
    }
  }
  rule {
    id     = "dynamodb-backups"
    status = "Enabled"
    filter {
      prefix = "backups/dynamodb/"
    }
    transition {
      days          = var.backup_transition_days
      storage_class = "GLACIER"
    }
    expiration {
      days = var.backup_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
  lifecycle {
    precondition {
      condition     = var.backup_retention_days >= var.backup_transition_days + 90
      error_message = "Backups devem permanecer ao menos 90 dias em Glacier antes da expiração."
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.this["access_logs"].id
  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.access_logs_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = var.access_logs_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  rule {
    id     = "remove-expired-delete-markers"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}
