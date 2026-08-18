# 汉业排车小程序端

`mobile/` 是原生微信小程序工程，当前聚焦跟单员移动排车/派车场景，复用现有 Express API 和同一套 PostgreSQL 数据。

## 已覆盖功能

- 系统账号登录，沿用 Web 端账号、角色和 `dispatchBoard` 权限。
- 按日期查看排车表，支持前一天、后一天、今天和日期选择。
- 排车卡片显示客户、订单号、排车号、装车时间、车牌、司机、口岸、进出口、吨位、装卸路线、车辆来源、订单状态和备注。
- 状态池统计与筛选：预排、已派车、通关中、已签收、异常滞留。
- 新建排车单：移动端保存时会创建运输订单，再写入当天排车表。
- 编辑排车单：同步更新关联订单的客户、车辆、路线、状态等字段。
- 复制排车单：复用原单内容生成新的订单和排车单。
- 从“待排订单”一键加入当天排车表。
- 删除排车单、上移/下移、批量生成派车信息、复制排车单、同步车辆/司机信息到订单。
- 风险提示：重复车牌、重复司机、车辆/司机状态异常和证件/保险过期。

## 本地调试

1. 先启动后端服务：

```bash
cd /Users/tree/Desktop/code/hanye-system/server
PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=hanye PGUSER=hanye PGPASSWORD=hanye_dev_password npm run dev
```

2. 用微信开发者工具打开 `/Users/tree/Desktop/code/hanye-system/mobile`。
3. 登录页不展示服务器地址，开发版默认连接 `http://127.0.0.1:8080/api`，体验版和正式版默认连接 `https://oa.hanyeltd.com/api`。

## 上线配置

- `mobile/project.config.json` 已配置正式小程序 AppID：`wx82dcadc96976af5f`。
- 生产环境服务器地址必须使用 HTTPS，当前使用 `https://oa.hanyeltd.com/api`。
- 在微信公众平台配置 request 合法域名：`https://oa.hanyeltd.com`，域名需要指向同一套后端 API。
- 上传图片/附件如走 OSS 直传或访问 OSS 文件，还需要在微信公众平台同步配置对应的 uploadFile/downloadFile 合法域名。
- 接口地址会按小程序运行环境自动切换，开发版走本地，体验版和正式版走线上，不需要发布前手动改代码。
- 小程序端不维护复杂模板和财务规则，相关配置仍在 PC 端完成。

## 真机预览排查

- 当前已关闭 source map 上传，并排除了 README、私有配置和系统隐藏文件，减少预览上传时的网络中断。
- 如果预览提示 `read ECONNRESET`，优先在微信开发者工具右上角退出后重新扫码登录，再关闭旧项目，只打开 `/Users/tree/Desktop/code/hanye-system/mobile`。
- 如果仍然失败，执行“工具 -> 清缓存 -> 清除登录状态”和“工具 -> 清缓存 -> 清除项目缓存”，重启微信开发者工具后再预览。
- 微信开发者工具日志出现 `access_token missing`、`getNewTicket empty ticket/userInfo` 时，说明是工具登录票据失效，不是小程序代码编译错误。
