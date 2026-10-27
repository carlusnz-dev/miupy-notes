output "role_arns" {
  description = "ARNs determinísticos, inclusive API/OIDC ainda desligados; use em condições aws:PrincipalArn de S3 para evitar ciclos."
  value       = local.role_arns
}
output "human_user_names" {
  description = "Usuários sem senha, access key ou dispositivo MFA criado pelo Terraform."
  value       = { for key, user in aws_iam_user.human : key => user.name }
}
output "group_names" {
  description = "Grupos por papel; nenhuma permissão direta de aplicação."
  value       = { for key, group in aws_iam_group.human : key => group.name }
}
output "runtime_boundary_arn" {
  description = "Boundary protegida do provisionador; alterações exigem identidade externa autorizada."
  value       = aws_iam_policy.runtime_boundary.arn
}
output "api_role_arn" {
  description = "Role efetivamente criada, nula enquanto a infraestrutura da API não foi informada."
  value       = var.enable_api_role ? aws_iam_role.api[0].arn : null
}
output "github_deploy_role_arn" {
  description = "Confiança OIDC opcional sem permissões de deploy; nula por padrão."
  value       = var.enable_github_oidc ? aws_iam_role.github_deploy[0].arn : null
}
