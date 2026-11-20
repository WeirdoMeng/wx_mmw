# 妙妙屋云函数

使用同一个传统文档数据库云环境部署 `mmw` 函数。微信开发者工具中上传时选择云端安装依赖，函数依赖 `wx-server-sdk@4.0.2`。环境及函数的 Node.js 运行时至少为 16，建议在云函数高级配置中将执行超时设为 20 秒，为图片校验和转存留出时间。

## 集合和访问规则

创建下列集合，并在控制台将所有集合设为「仅管理端可读写」。规则正文见 [database.rules.json](database.rules.json)。小程序通过云函数访问业务数据。

| 集合 | 内容 |
| --- | --- |
| `mmw_config` | 负责人配置 |
| `mmw_accounts` | 微信账号身份和绑定 |
| `mmw_students` | 学生资料、所属老师和监护人确认时间 |
| `mmw_invites` | 一次性二维码邀请 |
| `mmw_assignments` | 家长上传的作业 |
| `mmw_days` | 每个学生和日期的一份整体完成反馈 |
| `mmw_posts` | 餐食与日常 |
| `mmw_uploads` | 上传凭证和关联业务记录 |

添加以下非唯一复合索引。若已有字段和方向一致的索引可直接使用。

| 集合 | 按顺序配置索引字段 |
| --- | --- |
| `mmw_students` | `active` 升序，`_id` 升序 |
| `mmw_students` | `active` 升序，`teacherOpenid` 升序，`_id` 升序 |
| `mmw_assignments` | `studentId` 升序，`date` 升序，`createdAt` 升序，`_id` 升序 |
| `mmw_posts` | `type` 升序，`date` 降序，`createdAt` 降序，`_id` 降序 |

## 负责人和扫码版本

- 在 `mmw_config` 创建文档 `owner`，并将 `openid` 设为负责人自己在当前小程序的 OpenID。也可以在函数环境变量设置 `MMW_OWNER_OPENID`，环境变量优先。不需要在代码中填写标识。
- 二维码跟随发码小程序的运行版本。需要固定版本时可设置函数环境变量 `MMW_QR_ENV_VERSION`。体验版和开发版使用微信的小程序码版本参数，正式版检查发布页面。个人主体生成小程序码需要完成微信认证。
- 在首次配置负责人之前，云函数只向访问者返回其本人的 OpenID。类型为老师的二维码仅由负责人创建，家长绑定的二维码由负责人或老师创建。二维码有效期为 24 小时。
- 远端使用云函数运行上下文的环境 ID 校验图片。开发者工具本地调试云函数时，可将 `MMW_STORAGE_ENV_ID` 设为所用的测试云环境 ID。

## 图片权限

将云存储设为 [storage.rules.json](storage.rules.json) 中的自定义规则。配置文件内容需在云控制台应用并实测上传。规则允许微信账号在 `mmw/staging/` 创建和维护自己的临时对象，由云函数验证该对象对应的上传凭证、文件格式和大小。正式照片以私有对象保存在 `mmw/media/`，只有云函数可写入。

如果云环境的体验套餐限制自定义权限，使用合成图片联调。启用正式照片前，用两个普通微信账号核对云存储拒绝文件 ID 直接访问、已授权家长可以打开反馈图片、退出绑定后无法获取新的图片链接。

照片仅在业务记录通过鉴权后签发短时链接，SDK 请求有效期为 300 秒。删除学生会结束绑定并阻断新查询与新签发。已签发的短时链接在有效期内仍可能打开。可为临时目录配置生命周期清理未完成的上传，永久删除正式照片需按托管中心的数据保留规则处理。

## 验证

运行 `npm test`。测试用注入的数据库和云 SDK 代替部署环境，验证身份、邀请兑换、作业和反馈、私有图片关联及动态分页。真实扫码和存储权限需在目标云环境验证。

[微信事务指南](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/database/transaction.html) · [微信小程序码](https://developers.weixin.qq.com/miniprogram/dev/server/API/qrcode-link/qr-code/api_getunlimitedqrcode.html) · [微信云存储安全规则](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/storage/security-rules.html) · [微信临时文件链接](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-sdk-api/storage/Cloud.getTempFileURL.html)
