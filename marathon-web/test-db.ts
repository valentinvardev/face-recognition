import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    console.log('Testing DB connection...')
    const runners = await prisma.runner.findMany()
    console.log('Success! Found runners:', runners.length)
  } catch (err) {
    console.error('DB Connection Failed:', err)
  } finally {
    await prisma.$disconnect()
  }
}

main()
