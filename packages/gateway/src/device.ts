import { hostname, platform, arch } from 'node:os'

export function getDeviceInfo() {
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    nodeVersion: process.version,
  }
}
