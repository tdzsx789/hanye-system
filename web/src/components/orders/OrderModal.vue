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
  },
  title: {
    type: String,
    default: ""
  },
  submitLabel: {
    type: String,
    default: "保存订单"
  },
  submitIcon: {
    type: String,
    default: "save"
  },
  showSubmit: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["close", "submit", "panelClick"]);
</script>

<template>
  <div v-if="open" class="modal-backdrop">
    <form class="modal-card order-modal-card" @click="emit('panelClick')" @submit.prevent="emit('submit')">
      <div class="modal-head">
        <h2>
          {{ title || (editing ? '编辑订单' : '新建订单') }}
          <span class="order-title-meta">客户：{{ customer || "-" }}</span>
          <span class="order-title-meta">订单号：{{ orderNo }}</span>
        </h2>
        <button type="button" class="icon-btn" @click="emit('close')"><IconSvg name="close" />关闭</button>
      </div>
      <slot />
      <div class="modal-actions">
        <div v-if="$slots.actionsLeading" class="modal-actions-leading">
          <slot name="actionsLeading" />
        </div>
        <button type="button" class="ghost-btn" @click="emit('close')">{{ showSubmit ? '取消' : '关闭' }}</button>
        <button v-if="showSubmit" class="primary-btn" type="submit" :disabled="loading"><IconSvg :name="submitIcon" />{{ submitLabel }}</button>
      </div>
    </form>
    <slot name="after" />
  </div>
</template>
