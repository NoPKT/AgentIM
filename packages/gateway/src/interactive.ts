import { createInterface } from 'node:readline'

/**
 * Prompt the user to select from a list of numbered options.
 * Returns the `value` of the chosen option.
 */
export async function promptSelect(
  question: string,
  options: { label: string; value: string }[],
): Promise<string> {
  console.log(question)
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`)
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`Please choose (1-${options.length}): `, (answer) => {
        const idx = parseInt(answer.trim(), 10) - 1
        if (idx >= 0 && idx < options.length) {
          rl.close()
          resolve(options[idx].value)
        } else {
          console.log(`Invalid choice. Please enter a number between 1 and ${options.length}.`)
          ask()
        }
      })
    }
    ask()
  })
}

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
