/**
 * Print a prominent security warning when starting AI agent processes.
 * Agents have powerful host capabilities (file I/O, shell execution) and
 * malicious prompt injection from shared chat rooms could exploit them.
 */
export function printSecurityBanner(suppress?: boolean): void {
  if (suppress || process.env.AGENTIM_NO_SECURITY_WARNING === '1') return

  const yellow = '\x1b[33m'
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'

  const lines = [
    `${yellow}${bold}+---------------------------------------------------------------+${reset}`,
    `${yellow}${bold}|                    SECURITY NOTICE                             |${reset}`,
    `${yellow}${bold}+---------------------------------------------------------------+${reset}`,
    `${yellow}| AI agents have powerful capabilities including file system     |${reset}`,
    `${yellow}| access and shell command execution. In a shared chat room,    |${reset}`,
    `${yellow}| malicious users could exploit prompt injection to make agents |${reset}`,
    `${yellow}| execute harmful commands on your machine.                     |${reset}`,
    `${yellow}|                                                               |${reset}`,
    `${yellow}| ${bold}STRONGLY RECOMMENDED:${reset}${yellow}                                        |${reset}`,
    `${yellow}|  * Run this gateway inside Docker or a VM                     |${reset}`,
    `${yellow}|  * Use --pass-env to control which env vars agents can see    |${reset}`,
    `${yellow}|  * Avoid exposing sensitive directories as working dirs       |${reset}`,
    `${yellow}|                                                               |${reset}`,
    `${yellow}| ${dim}Suppress: --no-security-warning or AGENTIM_NO_SECURITY_WARNING=1${reset}${yellow} |${reset}`,
    `${yellow}${bold}+---------------------------------------------------------------+${reset}`,
  ]

  console.error(lines.join('\n'))
}
