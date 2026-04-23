import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { claimTask, releaseTaskClaim } from './task-claim.js'

function claimFilePath(lockRoot: string, taskId: string): string {
  return join(join(lockRoot, '..', 'task-claims'), `${taskId}.json`)
}

test('claimTask immediately reclaims a dead-owner claim', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-task-claim-'))
  const lockRoot = join(rootDir, 'runtime.lock')
  const taskId = 'delivery_dead_owner'
  const claimPath = claimFilePath(lockRoot, taskId)

  try {
    await mkdir(join(rootDir, 'task-claims'), { recursive: true })
    await writeFile(claimPath, JSON.stringify({
      pid: 999999,
      task_id: taskId,
      delivery_id: 'delivery-1',
      claimed_at: new Date().toISOString(),
    }, null, 2))

    const claimed = await claimTask(lockRoot, taskId, 'delivery-2')
    const raw = await readFile(claimPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number; delivery_id: string | null }

    assert.equal(claimed, true)
    assert.equal(payload.pid, process.pid)
    assert.equal(payload.delivery_id, 'delivery-2')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('claimTask reclaims a same-pid claim from a previous runtime lease', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-task-claim-'))
  const lockRoot = join(rootDir, 'runtime.lock')
  const taskId = 'delivery_same_pid_previous_runtime'
  const claimPath = claimFilePath(lockRoot, taskId)

  try {
    await mkdir(join(rootDir, 'task-claims'), { recursive: true })
    await writeFile(lockRoot, JSON.stringify({
      pid: process.pid,
      acquired_at: new Date(Date.now() - 60_000).toISOString(),
      renewed_at: new Date(Date.now() - 30_000).toISOString(),
      plugin_id: 'knotwork-bridge',
    }, null, 2))
    await writeFile(claimPath, JSON.stringify({
      pid: process.pid,
      task_id: taskId,
      delivery_id: 'delivery-old-runtime',
      claimed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    }, null, 2))

    const claimed = await claimTask(lockRoot, taskId, 'delivery-current-runtime')
    const raw = await readFile(claimPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number; delivery_id: string | null }

    assert.equal(claimed, true)
    assert.equal(payload.pid, process.pid)
    assert.equal(payload.delivery_id, 'delivery-current-runtime')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('claimTask keeps a live foreign owner claim in place', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-task-claim-'))
  const lockRoot = join(rootDir, 'runtime.lock')
  const taskId = 'delivery_live_owner'
  const claimPath = claimFilePath(lockRoot, taskId)
  const liveForeignPid = Number((process as unknown as { ppid?: number }).ppid || process.pid)

  try {
    await mkdir(join(rootDir, 'task-claims'), { recursive: true })
    await writeFile(claimPath, JSON.stringify({
      pid: liveForeignPid,
      task_id: taskId,
      delivery_id: 'delivery-live',
      claimed_at: new Date().toISOString(),
    }, null, 2))

    const claimed = await claimTask(lockRoot, taskId, 'delivery-next')
    const raw = await readFile(claimPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number; delivery_id: string | null }

    assert.equal(claimed, false)
    assert.equal(payload.pid, liveForeignPid)
    assert.equal(payload.delivery_id, 'delivery-live')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('claimTask reclaims a malformed stale claim file', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-task-claim-'))
  const lockRoot = join(rootDir, 'runtime.lock')
  const taskId = 'delivery_malformed'
  const claimPath = claimFilePath(lockRoot, taskId)

  try {
    await mkdir(join(rootDir, 'task-claims'), { recursive: true })
    await writeFile(claimPath, '{not-json')
    const stale = new Date(Date.now() - 11 * 60_000)
    await utimes(claimPath, stale, stale)

    const claimed = await claimTask(lockRoot, taskId, 'delivery-recovered')
    const raw = await readFile(claimPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number; delivery_id: string | null }

    assert.equal(claimed, true)
    assert.equal(payload.pid, process.pid)
    assert.equal(payload.delivery_id, 'delivery-recovered')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('releaseTaskClaim only removes the current owner claim', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-task-claim-'))
  const lockRoot = join(rootDir, 'runtime.lock')
  const taskId = 'delivery_release'
  const claimPath = claimFilePath(lockRoot, taskId)

  try {
    await mkdir(join(rootDir, 'task-claims'), { recursive: true })
    await writeFile(claimPath, JSON.stringify({
      pid: process.pid,
      task_id: taskId,
      delivery_id: 'delivery-owned',
      claimed_at: new Date().toISOString(),
    }, null, 2))

    await releaseTaskClaim(lockRoot, taskId, process.pid)
    await assert.rejects(readFile(claimPath, 'utf8'))

    await writeFile(claimPath, JSON.stringify({
      pid: 999999,
      task_id: taskId,
      delivery_id: 'delivery-foreign',
      claimed_at: new Date().toISOString(),
    }, null, 2))
    await releaseTaskClaim(lockRoot, taskId, process.pid)

    const raw = await readFile(claimPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number; delivery_id: string | null }
    assert.equal(payload.pid, 999999)
    assert.equal(payload.delivery_id, 'delivery-foreign')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
