<script setup>
import DataTable from "./DataTable.vue";
import IconSvg from "./IconSvg.vue";

defineProps({
  files: {
    type: Array,
    default: () => []
  },
  canUpload: {
    type: Boolean,
    default: false
  },
  uploading: {
    type: Boolean,
    default: false
  },
  accept: {
    type: String,
    default: ""
  },
  uploadLabel: {
    type: String,
    default: "上传附件"
  },
  disabledMessage: {
    type: String,
    default: "请先保存资料，再上传附件"
  },
  hint: {
    type: String,
    default: ""
  },
  emptyText: {
    type: String,
    default: "暂无附件"
  },
  showRecycle: {
    type: Boolean,
    default: false
  },
  readonly: {
    type: Boolean,
    default: false
  },
  formatSize: {
    type: Function,
    default: (size) => String(size || 0)
  }
});

const emit = defineEmits(["upload", "disabledUpload", "preview", "download", "delete", "recycle"]);

const columns = [
  { key: "category", label: "分类" },
  { key: "filename", label: "文件名" },
  { key: "size", label: "大小" },
  { key: "createdAt", label: "上传时间" },
  { key: "actions", label: "操作", cellClass: "row-actions" }
];
</script>

<template>
  <div class="file-panel">
    <div v-if="!readonly" class="file-toolbar">
      <label v-if="canUpload" class="file-upload-btn" :class="{ 'is-uploading': uploading }">
        <IconSvg name="upload" />{{ uploadLabel }}
        <input type="file" :accept="accept" :disabled="uploading" @change="emit('upload', $event)" />
      </label>
      <button v-else class="file-upload-btn is-disabled" type="button" @click="emit('disabledUpload')">
        <IconSvg name="upload" />{{ uploadLabel }}
      </button>
      <button v-if="showRecycle" class="ghost-btn small" type="button" @click="emit('recycle')">
        <IconSvg name="archive" />附件回收站
      </button>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </div>
    <DataTable :columns="columns" :rows="files" :empty-text="emptyText">
      <template #cell-category="{ row }">{{ row.category || '附件' }}</template>
      <template #cell-size="{ row }">{{ formatSize(row.size) }}</template>
      <template #cell-actions="{ row }">
        <button class="icon-btn" type="button" @click="emit('preview', row)"><IconSvg name="eye" />预览</button>
        <button class="icon-btn" type="button" @click="emit('download', row)"><IconSvg name="download" />下载</button>
        <button v-if="!readonly" class="icon-btn danger" type="button" @click="emit('delete', row)"><IconSvg name="trash" />删除</button>
      </template>
    </DataTable>
  </div>
</template>
