<script setup>
import { computed } from "vue";
import AttachmentPanel from "../AttachmentPanel.vue";

const props = defineProps({
  orderNo: {
    type: String,
    default: ""
  },
  files: {
    type: Array,
    default: () => []
  },
  uploading: {
    type: Boolean,
    default: false
  },
  accept: {
    type: String,
    default: ""
  },
  formatSize: {
    type: Function,
    required: true
  },
  readonly: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["upload", "preview", "download", "delete", "recycle", "disabledUpload"]);

const canUpload = computed(() => Boolean(props.orderNo) && !props.readonly);
const hint = computed(() =>
  props.orderNo
    ? "单据图片、照片、PDF 上传后会自动归档到当前订单。"
    : "当前订单还没有订单号，请先保存订单后再上传附件。"
);
</script>

<template>
  <AttachmentPanel
    class="order-attachment-panel"
    :files="files"
    :can-upload="canUpload"
    :uploading="uploading"
    :accept="accept"
    upload-label="上传订单附件"
    empty-text="暂无订单附件"
    :hint="hint"
    :show-recycle="!readonly"
    :readonly="readonly"
    :format-size="formatSize"
    @upload="emit('upload', $event)"
    @disabled-upload="emit('disabledUpload')"
    @preview="emit('preview', $event)"
    @download="emit('download', $event)"
    @delete="emit('delete', $event)"
    @recycle="emit('recycle')"
  />
</template>
