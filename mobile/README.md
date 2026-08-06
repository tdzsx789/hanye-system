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
- 删除排车单、上移/下移、复制派车文本、同步车辆/司机信息到订单。
- 风险提示：重复车牌、重复司机、车辆/司机状态异常和证件/保险过期。

## 本地调试

1. 先启动后端服务：

```bash
cd /Users/tree/Desktop/code/hanye-system/server
PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=hanye PGUSER=hanye PGPASSWORD=hanye_dev_password npm run dev
```

2. 用微信开发者工具打开 `/Users/tree/Desktop/code/hanye-system/mobile`。
3. 登录页的“服务器地址”默认是 `http://localhost:8080/api`，对应 Docker Web 代理后的后端 API。如果你直接运行后端，也可以改成对应端口，例如 `http://127.0.0.1:5174/api`。

## 上线配置

- 把 `mobile/project.config.json` 里的 `appid` 改成正式小程序 AppID。
- 生产环境服务器地址必须使用 HTTPS，例如 `https://www.524458.cn/api`。
- 在微信公众平台配置 request 合法域名，域名需要指向同一套后端 API。
- 小程序端不维护复杂模板和财务规则，相关配置仍在 PC 端完成。
