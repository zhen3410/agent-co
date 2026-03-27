#!/usr/bin/env node
/**
 * write-test-data.mjs
 *
 * 这个脚本用于向 Redis 写入测试数据，用于数据丢失演练。
 * - 写入 50 条测试消息（key 格式：demo:msg:{id}）
 * - 写入 5 个 thread 索引（key 格式：demo:thread:{name}）
 * - 写完后打印 dbsize 和 key 分布统计
 */

import Redis from 'ioredis'

// Redis 连接配置
const redis = new Redis('redis://localhost:6399')

async function writeTestData() {
  console.log('开始写入测试数据...\n')

  try {
    // 写入 50 条测试消息
    console.log('写入 50 条消息 (demo:msg:*)...')
    for (let i = 1; i <= 50; i++) {
      const key = `demo:msg:${i}`
      const value = JSON.stringify({
        id: i,
        content: `这是第 ${i} 条测试消息`,
        timestamp: new Date().toISOString(),
        author: `user_${(i % 10) + 1}`
      })
      await redis.set(key, value)
    }
    console.log('✓ 消息写入完成\n')

    // 写入 5 个 thread 索引
    console.log('写入 5 个 thread 索引 (demo:thread:*)...')
    const threadNames = ['general', 'support', 'feedback', 'announcements', 'random']
    for (const name of threadNames) {
      const key = `demo:thread:${name}`
      // 每个线程包含一些消息 ID 引用
      const messageIds = []
      for (let i = 0; i < 10; i++) {
        messageIds.push(`msg:${(threadNames.indexOf(name) * 10) + i + 1}`)
      }
      await redis.set(key, JSON.stringify({
        name,
        messageIds,
        createdAt: new Date().toISOString()
      }))
    }
    console.log('✓ Thread 索引写入完成\n')

    // 打印统计信息
    await printStats()

  } catch (error) {
    console.error('写入数据时出错:', error)
    process.exit(1)
  } finally {
    await redis.quit()
  }
}

async function printStats() {
  console.log('='.repeat(50))
  console.log('数据统计')
  console.log('='.repeat(50))

  // 获取 dbsize
  const dbsize = await redis.dbsize()
  console.log(`\n总 key 数量 (DBSIZE): ${dbsize}`)

  // 统计各 namespace 的 key 数量
  console.log('\nKey 分布统计:')

  // 统计 demo:msg:* 数量
  const msgKeys = await redis.keys('demo:msg:*')
  console.log(`  - demo:msg:*   : ${msgKeys.length} 个`)

  // 统计 demo:thread:* 数量
  const threadKeys = await redis.keys('demo:thread:*')
  console.log(`  - demo:thread:*: ${threadKeys.length} 个`)

  // 其他 key（如果有）
  const allKeys = await redis.keys('*')
  const otherCount = allKeys.length - msgKeys.length - threadKeys.length
  if (otherCount > 0) {
    console.log(`  - 其他         : ${otherCount} 个`)
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试数据写入完成!')
  console.log('='.repeat(50))
}

// 执行主函数
writeTestData()
