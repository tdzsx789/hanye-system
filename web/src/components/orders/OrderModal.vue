<script setup>
import IconSvg from "../IconSvg.vue";

defineProps({
  open: {
    type: Boolean,
    default: false
  },
  editing: {
    type: Boolean,
    default: false
  },
  customer: {
    type: String,
    default: ""
  },
  orderNo: {
    type: String,
    default: ""
  },
  loading: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["close", "submit", "panelClick"]);
</script>

<template>
  <div v-if="open" class="modal-backdrop">
    <form class="modal-card order-modal-card" @click="emit('panelClick')" @submit.prevent="emit('submit')">
      <div class="modal-head">
        <h2>
          {{ editing ? '编辑订单' : '新建订单' }}
          <span class="order-title-meta">经营单位：{{ customer || "-" }}</span>
          <span class="order-title-meta">订单号：{{ orderNo }}</span>
        </h2>
        <button type="button" class="icon-btn" @click="emit('close')"><IconSvg name="close" />关闭</button>
      </div>
      <slot />
      <div class="modal-actions">
        <button type="button" class="ghost-btn" @click="emit('close')">取消</button>
        <button class="primary-btn" type="submit" :disabled="loading"><IconSvg name="save" />保存订单</button>
      </div>
    </form>
    <slot name="after" />
  </div>
</template>
