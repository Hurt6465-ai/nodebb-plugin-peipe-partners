# nodebb-plugin-peipe-partners

Peipe 语伴 / 附近的人 NodeBB 插件。

## 功能

- `/partners` 找语伴页面
- `/nearby` 附近的人页面
- 统一批量接口：`GET /api/peipe-partners?mode=recommend|nearby`
- 用户资料缓存池每 20 分钟刷新一次
- 在线状态缓存每 8 分钟刷新一次，列表展示优先在线用户
- 附近定位 24 小时最多上传一次，服务端位置有效期 7 天，新定位覆盖旧定位
- 聊过的人不再出现在找语伴和附近的人列表
- 看过的人 24 小时内尽量少出现，用户不足时才补重复
- 陌生人打招呼每日限额：普通用户 8 次，VIP 群组用户 30 次
- 找语伴和附近的人打招呼次数共享同一额度
- 移动端资料弹窗，多语言，居中玻璃磨砂风格，选项为二级弹窗选择
- 本地 emoji 国旗，不依赖远程 flagcdn 图片

## 字段

插件使用这些 NodeBB 用户字段：

- `language_flag` 国籍
- `language_fluent` 母语
- `language_learning` 想学语言
- `gender` 性别
- `age` NodeBB 原有年龄字段
- `lat` 纬度
- `lng` 经度
- `languagePartnerGeoUpdatedAt` 定位更新时间
- `languagePartnerGeoExpiresAt` 定位过期时间

## 缓存策略

```txt
profilePoolTtlMs = 20 分钟
onlineTtlMs      = 8 分钟
locationSyncMs   = 24 小时
locationTtlMs    = 7 天
seenTtlMs        = 24 小时
dailyGreetLimit  = 8
vipDailyGreetLimit = 30
```

资料缓存池比较重，所以 20 分钟更新一次；在线状态只读取 NodeBB 的在线用户集合，比较轻，所以单独 8 分钟更新一次。

## VIP 群组

默认识别这些群组名为 VIP：

```js
['vip', 'VIP', 'Vip', 'premium', 'Premium', 'VIP会员', '会员']
```

如果你的 NodeBB VIP 群组名不同，修改 `lib/partner.js` 里的 `CONFIG.vipGroups`。

## 多语言

语言文件在：

```txt
languages/zh-CN/peipe-partners.json
languages/en-GB/peipe-partners.json
languages/my-MM/peipe-partners.json
languages/vi/peipe-partners.json
```

添加新语言时复制其中一份到对应语言目录即可。国家、语言、性别选项在：

```txt
data/options.json
```

## 安装

上传到 GitHub 仓库：

```txt
https://github.com/Hurt6465-ai/nodebb-plugin-peipe-partners
```

在 NodeBB 目录执行：

```bash
npm install git+https://github.com/Hurt6465-ai/nodebb-plugin-peipe-partners.git
./nodebb build
./nodebb restart
```

如果安装过旧版冲突插件，先禁用旧插件：

```bash
./nodebb reset -p nodebb-plugin-peipe-partner-api
./nodebb reset -p nodebb-plugin-language-partner
./nodebb build
./nodebb restart
```

## 验证

打开：

```txt
/partners
/nearby
```

浏览器控制台：

```js
window.PEIPE_PARTNER_FRONTEND_VERSION
```

应返回：

```txt
plugin-1.1.0
```

接口验证：

```js
fetch('/api/peipe-partners?mode=recommend&limit=2')
  .then(r => r.json())
  .then(console.log)
```

返回中应包含：

```txt
poolTtl: 1200
onlineTtl: 480
poolCount
candidateCount
users
```

## 打招呼接口

前端私信按钮调用：

```http
POST /api/peipe-partners/me/greet
Content-Type: application/json

{ "uid": 123 }
```

返回：

```json
{
  "ok": true,
  "roomId": 1,
  "quota": {
    "limit": 8,
    "used": 1,
    "remaining": 7
  }
}
```

超过次数：

```json
{
  "ok": false,
  "error": "greet-limit-exceeded",
  "quota": {
    "limit": 8,
    "used": 8,
    "remaining": 0
  }
}
```
