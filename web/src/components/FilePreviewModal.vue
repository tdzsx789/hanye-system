<script setup>
import { computed } from "vue";
import BaseModal from "./BaseModal.vue";
import IconSvg from "./IconSvg.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  file: {
    type: Object,
    default: null
  },
  endpoint: {
    type: Function,
    required: true
  }
});

const emit = defineEmits(["close", "download"]);

const previewUrl = computed(() => props.file ? props.endpoint(props.file, "preview") : "");
const isImage = computed(() => String(props.file?.mime || "").startsWith("image/"));
</script>

<template>
  <BaseModal
    :open="open && Boolean(file)"
    title="附件预览"
    :meta="file?.filename || ''"
    backdrop-class="file-preview-backdrop"
    card-class="file-preview-modal"
    body-class="file-preview-body"
    @close="emit('close')"
  >
    <template #headActions>
      <button type="button" class="icon-btn" @click="emit('download', file)">
        <IconSvg name="download" />下载
      </button>
    </template>
    <img
      v-if="isImage"
      class="file-preview-image"
      :src="previewUrl"
      :alt="file?.filename"
    />
    <iframe
      v-else
      class="file-preview-frame"
      :src="previewUrl"
      :title="file?.filename"
    />
  </BaseModal>
</template>
