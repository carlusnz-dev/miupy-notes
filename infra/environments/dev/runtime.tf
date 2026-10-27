resource "aws_dynamodb_table" "data" {
  name                        = "${var.name_prefix}-data"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true
  tags                        = local.tags

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = module.data_key.key_arn
  }
  lifecycle {
    prevent_destroy = true
  }
}

# O bundle é gerado localmente por npm run bundle:lambda antes de qualquer plan.
data "archive_file" "lambda" {
  type             = "zip"
  source_file      = "${path.root}/../../../apps/api/dist/lambda.js"
  output_file_mode = "0644"
  output_path      = "${path.root}/../../../apps/api/dist/lambda.zip"
}

resource "aws_lambda_function" "api" {
  function_name                  = "${var.name_prefix}-api"
  role                           = module.iam.api_role_arn
  handler                        = "lambda.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  filename                       = data.archive_file.lambda.output_path
  source_code_hash               = data.archive_file.lambda.output_base64sha256
  timeout                        = var.lambda_timeout_seconds
  memory_size                    = var.lambda_memory_mb
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = local.tags

  environment {
    variables = {
      NOTES_TABLE_NAME        = aws_dynamodb_table.data.name
      ALLOWED_SUBS_SECRET_ARN = var.allowed_subs_secret_arn
      LOG_FORMAT              = "json"
    }
  }

  # O grupo cifrado e a policy de execução devem existir antes da primeira invocação.
  depends_on = [module.observability, module.iam]
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"
  tags          = local.tags

  cors_configuration {
    allow_origins = sort(tolist(var.cors_allowed_origins))
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "google" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  name             = "google-id-token"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [var.google_client_id]
    issuer   = "https://accounts.google.com"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "authenticated" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "ANY /v1/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.google.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags

  access_log_settings {
    destination_arn = module.observability.log_group_arns.api
    format          = "{\"requestId\":\"$context.requestId\",\"route\":\"$context.routeKey\",\"status\":$context.status,\"responseLatency\":$context.responseLatency}"
  }
}

resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  # Apenas este HTTP API, em qualquer método/rota dos seus stages.
  source_arn = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
