import childProcess from 'child_process'
import path from 'path'
import builtInModules from 'builtin-modules'
import fs from 'fs'
import os, { tmpdir } from 'os'
import { dirname } from 'path'
import config from '../config/config'
import memoize from 'memoizee'
import { findNearestPackageJsonSync } from 'find-nearest-package-json'

const homeDirectory = os.homedir()

export function exec(command: string, options: any, timeout?: number) {
  let timerId: NodeJS.Timeout
  return new Promise((resolve, reject) => {
    const child = childProcess.exec(
      command,
      options,
      (error, stdout, stderr) => {
        if (error) {
          reject(stderr)
        } else {
          resolve(stdout)
        }

        if (timerId) {
          clearTimeout(timerId)
        }
      }
    )

    if (timeout) {
      timerId = setTimeout(() => {
        process.kill(child.pid)
        reject(
          `Execution of ${command.substring(
            0,
            40
          )}... cancelled as it exceeded a timeout of ${timeout} ms`
        )
      }, timeout)
    }
  })
}

/**
 * Gets external peerDeps that shouldn't be a
 * part of the build in a regex format -
 * /(^dep-a$|^dep-a\/|^dep-b$|^dep-b\/)\//
 */
export function getExternals(packageName: string, installPath: string) {
  const packageJSONPath = path.join(
    installPath,
    'node_modules',
    packageName,
    'package.json'
  )
  const packageJSON = require(packageJSONPath)
  const dependencies = Object.keys(packageJSON.dependencies || {})
  const peerDependencies = Object.keys(packageJSON.peerDependencies || {})

  // All packages with name same as a built-in node module, but
  // haven't explicitly been added as an npm dependency or aren't the package itself
  // are externals
  const builtInExternals = builtInModules.filter(
    mod => !dependencies.includes(mod) && mod !== packageName
  )
  return {
    externalPackages: peerDependencies,
    externalBuiltIns: builtInExternals,
  }
}

function expandTilde(pathString: string) {
  return homeDirectory
    ? pathString.replace(/^~(?=$|\/|\\)/, homeDirectory)
    : pathString
}

function isLocalPackageString(packageString: string) {
  const packageJsonPath = path.resolve(packageString, 'package.json')
  try {
    if (fs.existsSync(packageJsonPath)) {
      return true
    }
  } catch (err) {
    return false
  }
}

function isScopedPackageString(packageString: string) {
  return packageString.startsWith('@')
}

type ParsePackageResult = {
  name: string
  version: string | null
  scoped: boolean
  isLocal?: boolean
  normalPath?: string
}

function parseLocalPackageString(packageString: string): ParsePackageResult {
  const fullPath = path.resolve(packageString, 'package.json')
  const packageJSON = require(fullPath)

  return {
    name: packageJSON.name,
    version: packageJSON.version,
    scoped: packageJSON.name.startsWith('@'),
    normalPath: packageString,
    isLocal: true,
  }
}

function parseScopedPackageString(packageString: string): ParsePackageResult {
  const lastAtIndex = packageString.lastIndexOf('@')
  return {
    name:
      lastAtIndex === 0
        ? packageString
        : packageString.substring(0, lastAtIndex),
    version:
      lastAtIndex === 0 ? null : packageString.substring(lastAtIndex + 1),
    scoped: true,
  }
}

function parseUnscopedPackageString(packageString: string): ParsePackageResult {
  const lastAtIndex = packageString.lastIndexOf('@')
  return {
    name:
      lastAtIndex === -1
        ? packageString
        : packageString.substring(0, lastAtIndex),
    version:
      lastAtIndex === -1 ? null : packageString.substring(lastAtIndex + 1),
    scoped: false,
  }
}

export function parsePackageString(packageString: string): ParsePackageResult {
  const normalPackageString = expandTilde(packageString)

  if (isLocalPackageString(normalPackageString)) {
    return parseLocalPackageString(normalPackageString)
  } else if (isScopedPackageString(normalPackageString)) {
    return parseScopedPackageString(normalPackageString)
  } else {
    return parseUnscopedPackageString(normalPackageString)
  }
}

// Works only when the `path` begins with the package name
export const parsePackageNameFromPath = (path: string) => {
  const fragments = path.split('/')
  if (path.startsWith('@')) {
    return [fragments[0], fragments[1]].join('/')
  } else {
    return fragments[0]
  }
}

/**
 *
 */
export function getPackageFromWebpackPath(filePath: string) {
  let filePathReal = filePath.includes('!')
    ? filePath.split('!')[filePath.split('!').length - 1]
    : filePath

  let lastNodeModulesIndex =
    filePathReal.lastIndexOf('node_modules') + 'node_modules'.length + 1
  return {
    name: parsePackageNameFromPath(
      filePathReal.substring(lastNodeModulesIndex)
    ),
    cleanPath: filePathReal,
  }
}

export const getPackageJSONFromPath = memoize(
  (filePath: string): string | null => {
    const { cleanPath, name } = getPackageFromWebpackPath(filePath)
    const packageRoot = cleanPath.substring(
      0,
      cleanPath.lastIndexOf(name) + name.length
    )

    try {
      const packageJSON = require(path.join(packageRoot, 'package.json'))
      return packageJSON
    } catch (err) {
      return null
    }
  },
  { max: 1000 }
)

/**
 * eg.
 * loader!/private/tmp/tmp-build/packages/build-gulp-ORQ/node_modules/.pnpm/is-data@0.1.4/node_modules/is-data/index.js =>  is-data/index.js
 */
export function cleanWebpackPath(filePath: string, installPath: string) {
  // Webpack paths are of the form `loader!path`
  let filePathReal = filePath.includes('!')
    ? filePath.split('!')[filePath.split('!').length - 1]
    : filePath
  let fragments = filePathReal
    .substring(filePathReal.indexOf(installPath) + installPath.length + 1)
    .split(path.sep)

  // let currentFragment = fragments[0]
  // while (['node_modules', '.pnpm'].includes(currentFragment)) {
  //   currentFragment = fragments.shift() || ''
  // }

  return filePath //fragments.join(path.sep)
}

export function isReactNativePackage(packageName: string) {
  return packageName.startsWith('react-native')
}
