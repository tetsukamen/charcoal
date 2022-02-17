import child_process from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createDefer } from './defer'
import { PackageManagerInfo } from './packageManager'

/**
 * 指定したバージョンのパッケージが存在する状態で処理を行う
 *
 * @param packageDescripters 欲しいパッケージの一覧
 * @param callback 実行したい処理
 */
export async function withPackages<T>(
  packageManagerInfo: PackageManagerInfo,
  packageDescripters: readonly string[],
  callback: () => T | Promise<T>
): Promise<T> {
  if (packageDescripters.length === 0) {
    return callback()
  }

  const deferer = createDefer()
  const { defer, dispose } = deferer
  process.on('SIGINT', dispose)

  try {
    const tmpdir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tailwind-diff-packages-')
    )
    defer(() => {
      const files = fs.readdirSync(tmpdir)
      for (const file of files) {
        fs.unlinkSync(path.resolve(tmpdir, file))
      }
      fs.rmdirSync(tmpdir)
    })

    const backupPackageJSONPath = path.join(tmpdir, 'package.json')
    fs.copyFileSync(packageManagerInfo.packageJSONPath, backupPackageJSONPath)

    const packageLock =
      packageManagerInfo.lockfilePath != null
        ? {
            path: packageManagerInfo.lockfilePath,
            backup: path.join(
              tmpdir,
              path.basename(packageManagerInfo.lockfilePath)
            ),
          }
        : undefined
    if (packageLock != null) {
      fs.copyFileSync(packageLock.path, packageLock.backup)
    }

    let cmd: string, recoverCmd: string
    switch (packageManagerInfo.type) {
      case 'npm':
        cmd = `npm install ${packageDescripters.join(' ')}`
        recoverCmd = 'npm install'
        break
      case 'yarn':
        cmd = `yarn add ${packageDescripters.join(' ')}`
        recoverCmd = 'yarn install'
        break
      case 'pnpm':
        cmd = `pnpm add ${packageDescripters.join(' ')}`
        recoverCmd = 'pnpm install'
        break
    }

    // execに失敗してもファイルは回復してほしい
    defer(() => {
      fs.unlinkSync(packageManagerInfo.packageJSONPath)
      fs.copyFileSync(backupPackageJSONPath, packageManagerInfo.packageJSONPath)
      if (packageLock != null) {
        fs.unlinkSync(packageLock.path)
        fs.copyFileSync(packageLock.backup, packageLock.path)
      }
      child_process.execSync(recoverCmd)
    })
    child_process.execSync(cmd)

    return callback()
  } finally {
    dispose()
    process.off('SIGINT', dispose)
  }
}
