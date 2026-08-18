<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import IconSvg from "./IconSvg.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: "上传附件"
  },
  description: {
    type: String,
    default: ""
  },
  accept: {
    type: String,
    default: ""
  },
  multiple: {
    type: Boolean,
    default: true
  },
  uploading: {
    type: Boolean,
    default: false
  },
  submitLabel: {
    type: String,
    default: "开始上传"
  }
});

const emit = defineEmits(["close", "submit"]);

const dropzoneRef = ref(null);
const fileInputRef = ref(null);
const fileItems = ref([]);
const dragging = ref(false);

const fileCountText = computed(() => {
  const count = fileItems.value.length;
  return count ? `${count} 个文件` : "未选择文件";
});

function formatUploadFileSize(size) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function fileKey(file) {
  return [file.name || "", file.size || 0, file.type || "", file.lastModified || 0].join("|");
}

function clipboardFilename(file) {
  const type = String(file?.type || "").toLowerCase();
  const extension = type.includes("png")
    ? "png"
    : type.includes("webp")
      ? "webp"
      : type.includes("gif")
        ? "gif"
        : "jpg";
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `paste-image-${stamp}.${extension}`;
}

function ensureClipboardFileName(file) {
  if (file?.name && String(file.name).trim()) return file;
  if (typeof File !== "function") return file;
  return new File([file], clipboardFilename(file), {
    type: file.type || "image/png",
    lastModified: Date.now()
  });
}

function addFiles(files, source = "选择") {
  const incoming = Array.from(files || []).filter(Boolean);
  if (!incoming.length || props.uploading) return;
  const existingKeys = new Set(fileItems.value.map((item) => fileKey(item.file)));
  const nextItems = [];
  incoming.forEach((file) => {
    const normalizedFile = source === "粘贴" ? ensureClipboardFileName(file) : file;
    const key = fileKey(normalizedFile);
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    nextItems.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file: normalizedFile,
      source
    });
  });
  if (!nextItems.length) return;
  fileItems.value = props.multiple ? [...fileItems.value, ...nextItems] : [nextItems[0]];
}

function chooseFiles() {
  if (props.uploading) return;
  fileInputRef.value?.click();
}

function handleFileInput(event) {
  addFiles(event.target.files, "选择");
  event.target.value = "";
}

function handleDrop(event) {
  dragging.value = false;
  addFiles(event.dataTransfer?.files, "拖拽");
}

function extractPastedFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const itemFiles = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  return itemFiles.length ? itemFiles : Array.from(event.clipboardData?.files || []);
}

function handlePaste(event) {
  const pastedFiles = extractPastedFiles(event);
  if (!pastedFiles.length) return;
  event.preventDefault();
  addFiles(pastedFiles, "粘贴");
}

function removeFile(id) {
  if (props.uploading) return;
  fileItems.value = fileItems.value.filter((item) => item.id !== id);
}

function clearFiles() {
  if (props.uploading) return;
  fileItems.value = [];
}

function submitFiles() {
  if (!fileItems.value.length || props.uploading) return;
  emit("submit", fileItems.value.map((item) => item.file));
}

function requestClose() {
  if (props.uploading) return;
  emit("close");
}

function addDocumentPasteListener() {
  document.addEventListener("paste", handlePaste);
}

function removeDocumentPasteListener() {
  document.removeEventListener("paste", handlePaste);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      fileItems.value = [];
      dragging.value = false;
      addDocumentPasteListener();
      nextTick(() => dropzoneRef.value?.focus?.());
    } else {
      removeDocumentPasteListener();
    }
  }
);

onBeforeUnmount(removeDocumentPasteListener);
</script>

<template>
  <div v-if="open" class="modal-backdrop nested-modal-backdrop upload-panel-backdrop" @click.self="requestClose">
    <section class="modal-card compact-modal upload-panel-modal" @keydown.esc.prevent="requestClose">
      <div class="modal-head">
        <div>
          <p class="eyebrow">附件上传</p>
          <h2>{{ title }}</h2>
        </div>
        <button class="icon-btn" type="button" :disabled="uploading" @click="requestClose">
          <IconSvg name="close" />关闭
        </button>
      </div>
      <div class="modal-body upload-panel-body">
        <p v-if="description" class="upload-panel-description">{{ description }}</p>
        <input
          ref="fileInputRef"
          class="upload-panel-file-input"
          type="file"
          :accept="accept"
          :multiple="multiple"
          :disabled="uploading"
          @change="handleFileInput"
        />
        <button
          ref="dropzoneRef"
          class="upload-dropzone"
          :class="{ 'is-dragging': dragging, 'is-uploading': uploading }"
          type="button"
          :disabled="uploading"
          @click="chooseFiles"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="handleDrop"
          @paste="handlePaste"
        >
          <span class="upload-dropzone-icon"><IconSvg name="upload" /></span>
          <strong>拖拽文件到这里</strong>
          <span>点击选择文件，或粘贴复制的图片</span>
        </button>
        <div class="upload-panel-queue-head">
          <strong>{{ fileCountText }}</strong>
          <button v-if="fileItems.length" class="ghost-btn small" type="button" :disabled="uploading" @click="clearFiles">
            清空
          </button>
        </div>
        <div v-if="fileItems.length" class="upload-panel-file-list">
          <div v-for="item in fileItems" :key="item.id" class="upload-panel-file-row">
            <IconSvg name="file" />
            <span class="upload-panel-file-name" :title="item.file.name">{{ item.file.name }}</span>
            <span class="upload-panel-file-meta">{{ item.source }} · {{ formatUploadFileSize(item.file.size) }}</span>
            <button class="icon-btn icon-only" type="button" title="移除" :disabled="uploading" @click="removeFile(item.id)">
              <IconSvg name="close" />
            </button>
          </div>
        </div>
        <p v-else class="upload-panel-empty">支持图片和 PDF，文件不能超过系统限制。</p>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" :disabled="uploading" @click="requestClose">取消</button>
        <button class="primary-btn" type="button" :disabled="uploading || !fileItems.length" @click="submitFiles">
          <IconSvg name="upload" />{{ uploading ? '上传中' : submitLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
