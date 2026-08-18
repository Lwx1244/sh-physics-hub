/**
 * 短信验证码服务
 * 设计目标：解耦「发送短信」与「业务逻辑」，方便接入真实短信网关。
 *
 * 接入真实服务商（阿里云/腾讯云/云片 等）时，只需实现 sendSms(phone, text)，
 * 并在环境变量中配置 SMS_PROVIDER=aliyun（或你自己的标识）与对应密钥即可。
 * 未配置真实服务商时，进入「演示模式」：不真正外发，仅在服务端日志打印验证码，
 * 并通过 /api/sms/send 的响应 devCode 回传给前端（仅演示/本地环境使用）。
 */
const crypto = require('crypto');

// 演示模式判断：未设置真实短信服务商环境变量即为演示
const REAL_PROVIDER = !!process.env.SMS_PROVIDER;

function genCode() {
  // 6 位数字验证码
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * 发送短信。返回 true 表示已真实发送，false 表示进入演示模式。
 * 真实服务商接入示例（伪代码，按所选网关 SDK 实现）：
 *
 *   if (process.env.SMS_PROVIDER === 'aliyun') {
 *     // const client = new Dysmsapi(...); await client.sendSms({ PhoneNumbers: phone, ... })
 *     return true;
 *   }
 */
async function sendSms(phone, code) {
  const text = `【上海高中物理平台】您的管理员登录验证码为 ${code}，5 分钟内有效，请勿泄露。`;
  if (REAL_PROVIDER) {
    try {
      // === 在这里对接真实短信网关 ===
      // 例如：await realProvider.send(phone, text);
      console.log(`[SMS:${process.env.SMS_PROVIDER}] → ${phone}: ${text}`);
      return true;
    } catch (e) {
      console.error('短信发送失败:', e.message);
      return false;
    }
  }
  // 演示模式：仅打印到服务端日志
  console.log(`[SMS:DEMO] → ${phone}: ${text}`);
  return false;
}

module.exports = { REAL_PROVIDER, genCode, sendSms };
