import { createInterface } from 'node:readline'

/**
 * Prompt the user for text input via stdin.
 */
export function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Prompt the user for a password, masking input with '*'.
 */
export function promptPassword(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question)

    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) {
      stdin.setRawMode(true)
    }
    stdin.resume()
    stdin.setEncoding('utf8')

    let password = ''

    const onData = (ch: string) => {
      const c = ch.toString()

      if (c === '\n' || c === '\r' || c === '\u0004') {
        // Enter or Ctrl+D
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false)
        }
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(password)
      } else if (c === '\u0003') {
        // Ctrl+C
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false)
        }
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        reject(new Error('interrupted'))
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        password += c
        process.stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })
}
