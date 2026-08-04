<script setup>
import IconSvg from "../IconSvg.vue";

defineProps({
  order: {
    type: Object,
    default: null
  },
  feeRoleLabels: {
    type: Object,
    default: () => ({})
  },
  currencyCodeDisplay: {
    type: Function,
    required: true
  },
  money: {
    type: Function,
    required: true
  },
  normalizeTransportMode: {
    type: Function,
    required: true
  },
  orderDetailDriverText: {
    type: Function,
    required: true
  },
  orderStatusClass: {
    type: Function,
    required: true
  },
  orderDetailFeeRows: {
    type: Function,
    required: true
  }
});

const emit = defineEmits(["close", "edit"]);
</script>

<template>
  <div v-if="order" class="modal-backdrop full-detail-backdrop" @click.self="emit('close')">
    <section class="modal-card full-detail-modal">
      <div class="modal-head">
        <div>
          <h2>{{ order.no }} · 订单明细</h2>
          <p class="modal-subtitle">{{ order.customer || '-' }} · {{ order.date || '-' }} · {{ order.status || '-' }}</p>
        </div>
        <div class="modal-detail-actions">
          <button class="ghost-btn small" type="button" @click="emit('edit', order)"><IconSvg name="edit" />编辑</button>
          <button type="button" class="icon-btn" @click="emit('close')"><IconSvg name="close" />关闭</button>
        </div>
      </div>
      <div class="modal-body full-detail-body">
        <div class="detail-section-grid">
          <section class="detail-section">
            <h3>订单信息</h3>
            <dl class="detail-dl">
              <dt>排车单号</dt><dd>{{ order.dispatchNo || '-' }}</dd>
              <dt>业务类型</dt><dd>{{ order.businessType || '-' }}</dd>
              <dt>口岸</dt><dd>{{ order.port || '-' }}</dd>
              <dt>进出口</dt><dd>{{ order.direction || '-' }}</dd>
              <dt>吨位</dt><dd>{{ order.tonnage || '-' }}</dd>
              <dt>件数/板数</dt><dd>{{ order.quantity || '-' }}</dd>
              <dt>重量</dt><dd>{{ order.weight || '-' }}</dd>
              <dt>币种</dt><dd>{{ currencyCodeDisplay(order.currency || '') || '-' }}</dd>
            </dl>
          </section>
          <section class="detail-section">
            <h3>车辆司机</h3>
            <dl class="detail-dl">
              <dt>车辆来源</dt><dd>{{ order.vehicleSource || '-' }}</dd>
              <dt>车牌</dt><dd>{{ order.plate || '-' }}</dd>
              <dt>运输模式</dt><dd>{{ normalizeTransportMode(order.transportMode || '') || '-' }}</dd>
              <dt>司机</dt><dd>{{ orderDetailDriverText(order) }}</dd>
              <dt>外派供应商</dt><dd>{{ order.supplier || '-' }}</dd>
              <dt>车次号</dt><dd>{{ order.tripNo || '-' }}</dd>
              <dt>六联单号</dt><dd>{{ order.sixSheetNo || '-' }}</dd>
              <dt>状态</dt><dd><span class="status-badge" :class="orderStatusClass(order.status)">{{ order.status || '-' }}</span></dd>
            </dl>
          </section>
          <section class="detail-section detail-section-wide">
            <h3>装卸与备注</h3>
            <dl class="detail-dl detail-dl-wide">
              <dt>装货地</dt><dd>{{ order.loading || '-' }}</dd>
              <dt>卸货地</dt><dd>{{ order.unloading || '-' }}</dd>
              <dt>备注</dt><dd>{{ order.remark || '-' }}</dd>
            </dl>
          </section>
        </div>
        <section class="detail-section">
          <h3>费用明细</h3>
          <div class="table-wrap detail-table-wrap">
            <table class="data-table compact">
              <thead><tr><th>序号</th><th>项目</th><th>类别</th><th>数量</th><th>金额</th><th>归属司机</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(fee, index) in orderDetailFeeRows(order)" :key="`${fee.name}-${index}`">
                  <td>{{ index + 1 }}</td>
                  <td>{{ fee.name || '-' }}</td>
                  <td>{{ fee.category || '-' }}</td>
                  <td>{{ Number(fee.quantity || 0) || '-' }}</td>
                  <td>{{ currencyCodeDisplay(fee.currency || '港币') }} {{ money(fee.amount) }}</td>
                  <td>{{ fee.driverName || feeRoleLabels[fee.driverRole] || '-' }}</td>
                  <td>{{ fee.remark || '-' }}</td>
                </tr>
                <tr v-if="orderDetailFeeRows(order).length === 0"><td colspan="7">暂无费用明细</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
