/* METADATA
{
  "name": "memoirs_automation",
  "description": "记忆之书工作流入口：判断是否为固定聊天安排一次自然邀请。",
  "tools": [
    {
      "name": "tick",
      "description": "检查固定聊天的空闲时间；符合条件时只创建 pending 邀请事件，不直接发送消息。",
      "parameters": []
    }
  ]
}
*/

import { armInvitationFromWorkflow } from "../chatSync";

async function tick(): Promise<Record<string, unknown>> {
  try {
    return await armInvitationFromWorkflow();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { tick };
