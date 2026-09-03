<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import BaseModal from "./BaseModal.vue";
import IconSvg from "./IconSvg.vue";

const MAX_PREVIEW_ROWS = 300;
const MAX_PREVIEW_COLUMNS = 80;
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const EXCEL_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/csv",
  "text/csv"
]);

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
  },
  requestHeaders: {
    type: Function,
    default: () => ({})
  }
});

const emit = defineEmits(["close", "download", "delete"]);

const previewUrl = computed(() => props.file ? props.endpoint(props.file, "preview") : "");
const contentUrl = computed(() => props.file?.id ? `/api/files/${encodeURIComponent(props.file.id)}/content` : previewUrl.value);
const filename = computed(() => String(props.file?.filename || ""));
const extension = computed(() => {
  const text = filename.value.toLowerCase();
  const index = text.lastIndexOf(".");
  return index >= 0 ? text.slice(index + 1) : "";
});
const mime = computed(() => String(props.file?.mime || "").split(";")[0].trim().toLowerCase());
const isImage = computed(() => mime.value.startsWith("image/"));
const isSpreadsheet = computed(() => EXCEL_EXTENSIONS.has(extension.value) || EXCEL_MIMES.has(mime.value));
const previewStageRef = ref(null);
const imageRotation = ref(0);
const imageZoom = ref(100);
const imageNaturalSize = ref({ width: 0, height: 0 });
const imageStageSize = ref({ width: 0, height: 0 });
let imageResizeObserver = null;

const workbookState = ref({
  loading: false,
  error: "",
  sheets: [],
  activeSheet: "",
  truncatedRows: 0,
  truncatedColumns: 0
});

const activeSheet = computed(() =>
  workbookState.value.sheets.find((sheet) => sheet.name === workbookState.value.activeSheet)
  || workbookState.value.sheets[0]
  || null
);
const activeRows = computed(() => activeSheet.value?.rows || []);
const activeColumnCount = computed(() => activeSheet.value?.columnCount || 0);
const imageRotationNormalized = computed(() => ((Number(imageRotation.value || 0) % 360) + 360) % 360);
const imageNaturalBounds = computed(() => {
  const width = Number(imageNaturalSize.value.width || 0);
  const height = Number(imageNaturalSize.value.height || 0);
  return { width, height };
});
const imageDisplayBounds = computed(() => {
  const width = Number(imageNaturalBounds.value.width || 0);
  const height = Number(imageNaturalBounds.value.height || 0);
  if (!width || !height) return { width: 0, height: 0 };
  return imageRotationNormalized.value % 180 === 0
    ? { width, height }
    : { width: height, height: width };
});
const imageFitScale = computed(() => {
  const width = Number(imageDisplayBounds.value.width || 0);
  const height = Number(imageDisplayBounds.value.height || 0);
  const stageWidth = Number(imageStageSize.value.width || 0);
  const stageHeight = Number(imageStageSize.value.height || 0);
  if (!width || !height || !stageWidth || !stageHeight) return 1;
  const viewportWidth = Math.max(1, stageWidth - 32);
  const viewportHeight = Math.max(1, stageHeight - 32);
  const fit = Math.min(viewportWidth / width, viewportHeight / height);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  return Math.min(1, fit);
});
const imageDisplayScale = computed(() => imageFitScale.value * (Number(imageZoom.value || 100) / 100));
const imageBoxStyle = computed(() => {
  const width = Number(imageDisplayBounds.value.width || 0);
  const height = Number(imageDisplayBounds.value.height || 0);
  if (!width || !height) return {};
  return {
    width: `${Math.max(1, Math.round(width * imageDisplayScale.value))}px`,
    height: `${Math.max(1, Math.round(height * imageDisplayScale.value))}px`
  };
});
const imageInnerStyle = computed(() => {
  const width = Number(imageNaturalBounds.value.width || 0);
  const height = Number(imageNaturalBounds.value.height || 0);
  if (!width || !height) return {};
  return {
    width: `${Math.max(1, Math.round(width * imageDisplayScale.value))}px`,
    height: `${Math.max(1, Math.round(height * imageDisplayScale.value))}px`,
    transform: `translate(-50%, -50%) rotate(${imageRotationNormalized.value}deg)`
  };
});
const imageZoomLabel = computed(() => `${Math.max(20, Math.min(400, Math.round(Number(imageZoom.value || 100))))}%`);

function syncPreviewStageSize() {
  const element = previewStageRef.value;
  if (!element) return;
  imageStageSize.value = {
    width: element.clientWidth || 0,
    height: element.clientHeight || 0
  };
}

function attachPreviewStageObserver() {
  if (imageResizeObserver) {
    imageResizeObserver.disconnect();
    imageResizeObserver = null;
  }
  const element = previewStageRef.value;
  if (!element) return;
  syncPreviewStageSize();
  if (typeof ResizeObserver === "undefined") return;
  imageResizeObserver = new ResizeObserver(() => syncPreviewStageSize());
  imageResizeObserver.observe(element);
}

function cleanupPreviewStageObserver() {
  if (!imageResizeObserver) return;
  imageResizeObserver.disconnect();
  imageResizeObserver = null;
}

function resetImageZoom() {
  imageZoom.value = 100;
  nextTick(() => syncPreviewStageSize());
}

function changeImageZoom(delta = 0) {
  const next = Math.max(20, Math.min(400, Math.round(Number(imageZoom.value || 100) + Number(delta || 0))));
  imageZoom.value = next;
}

function changeImageRotation(delta = 0) {
  imageRotation.value = ((Number(imageRotation.value || 0) + Number(delta || 0)) % 360 + 360) % 360;
  nextTick(() => syncPreviewStageSize());
}

function handleImageLoad(event) {
  const target = event?.target;
  if (!target) return;
  const width = Number(target.naturalWidth || 0);
  const height = Number(target.naturalHeight || 0);
  imageNaturalSize.value = { width, height };
  syncPreviewStageSize();
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return normalizeCellValue(value.result);
    return JSON.stringify(value);
  }
  return String(value);
}

function sheetRowsForPreview(sheet, XLSX) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const endRow = Math.min(range.e.r, range.s.r + MAX_PREVIEW_ROWS - 1);
  const endColumn = Math.min(range.e.c, range.s.c + MAX_PREVIEW_COLUMNS - 1);
  const rows = [];
  for (let rowIndex = range.s.r; rowIndex <= endRow; rowIndex += 1) {
    const row = [];
    for (let columnIndex = range.s.c; columnIndex <= endColumn; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[cellAddress];
      row.push(normalizeCellValue(cell?.w ?? cell?.v ?? ""));
    }
    rows.push(row);
  }
  return {
    rows,
    columnCount: Math.max(0, endColumn - range.s.c + 1),
    truncatedRows: Math.max(0, range.e.r - endRow),
    truncatedColumns: Math.max(0, range.e.c - endColumn)
  };
}

async function loadSpreadsheetPreview() {
  if (!props.open || !props.file || !isSpreadsheet.value) return;
  const url = contentUrl.value;
  if (!url) {
    workbookState.value = { loading: false, error: "附件地址不可用，请刷新后重试", sheets: [], activeSheet: "", truncatedRows: 0, truncatedColumns: 0 };
    return;
  }
  workbookState.value = { loading: true, error: "", sheets: [], activeSheet: "", truncatedRows: 0, truncatedColumns: 0 };
  try {
    const response = await fetch(url, {
      headers: props.requestHeaders({ Accept: "application/octet-stream" })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "读取 Excel 附件失败");
    }
    const buffer = await response.arrayBuffer();
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      dense: false
    });
    const sheets = workbook.SheetNames.map((name) => {
      const preview = sheetRowsForPreview(workbook.Sheets[name], XLSX);
      return { name, ...preview };
    });
    const firstSheet = sheets[0] || null;
    workbookState.value = {
      loading: false,
      error: "",
      sheets,
      activeSheet: firstSheet?.name || "",
      truncatedRows: firstSheet?.truncatedRows || 0,
      truncatedColumns: firstSheet?.truncatedColumns || 0
    };
  } catch (error) {
    workbookState.value = {
      loading: false,
      error: error.message || "Excel 附件预览失败，请下载后查看",
      sheets: [],
      activeSheet: "",
      truncatedRows: 0,
      truncatedColumns: 0
    };
  }
}

function selectSheet(sheet) {
  workbookState.value = {
    ...workbookState.value,
    activeSheet: sheet.name,
    truncatedRows: sheet.truncatedRows || 0,
    truncatedColumns: sheet.truncatedColumns || 0
  };
}

watch(
  () => [props.open, props.file?.id, props.file?.filename, props.file?.mime],
  async () => {
    cleanupPreviewStageObserver();
    imageRotation.value = 0;
    imageZoom.value = 100;
    imageNaturalSize.value = { width: 0, height: 0 };
    imageStageSize.value = { width: 0, height: 0 };
    if (props.open && isSpreadsheet.value) {
      loadSpreadsheetPreview();
    } else {
      workbookState.value = { loading: false, error: "", sheets: [], activeSheet: "", truncatedRows: 0, truncatedColumns: 0 };
    }
    if (props.open && isImage.value) {
      await nextTick();
      attachPreviewStageObserver();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  cleanupPreviewStageObserver();
});
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
      <span v-if="isImage" class="file-preview-zoom-tools" aria-label="图片缩放">
        <button type="button" class="icon-btn icon-only" title="向左旋转90度" aria-label="向左旋转90度" @click="changeImageRotation(-90)">
          <IconSvg name="rotateLeft" />
        </button>
        <button type="button" class="icon-btn icon-only" title="向右旋转90度" aria-label="向右旋转90度" @click="changeImageRotation(90)">
          <IconSvg name="rotateRight" />
        </button>
        <button type="button" class="icon-btn icon-only" title="缩小" aria-label="缩小" @click="changeImageZoom(-10)">
          <IconSvg name="minus" />
        </button>
        <button type="button" class="icon-btn icon-only" title="适应窗口" aria-label="适应窗口" @click="resetImageZoom">
          <IconSvg name="restore" />
        </button>
        <button type="button" class="icon-btn icon-only" title="放大" aria-label="放大" @click="changeImageZoom(10)">
          <IconSvg name="plus" />
        </button>
        <span class="file-preview-zoom-label">{{ imageZoomLabel }}</span>
      </span>
      <button type="button" class="icon-btn" @click="emit('download', file)">
        <IconSvg name="download" />下载
      </button>
      <button type="button" class="icon-btn danger" @click="emit('delete', file)">
        <IconSvg name="trash" />删除
      </button>
    </template>
    <div
      ref="previewStageRef"
      class="file-preview-stage"
      :class="{ 'is-image': isImage, 'is-frame': !isImage && !isSpreadsheet, 'is-spreadsheet': isSpreadsheet }"
    >
      <div v-if="isImage" class="file-preview-image-viewport">
        <div class="file-preview-image-box" :style="imageBoxStyle">
          <img
            class="file-preview-image"
            :src="previewUrl"
            :alt="file?.filename"
            :style="imageInnerStyle"
            @load="handleImageLoad"
          />
        </div>
      </div>
      <section v-else-if="isSpreadsheet" class="spreadsheet-preview">
        <div v-if="workbookState.loading" class="spreadsheet-preview-state">正在读取 Excel...</div>
        <div v-else-if="workbookState.error" class="spreadsheet-preview-state is-error">
          {{ workbookState.error }}
        </div>
        <div v-else-if="!workbookState.sheets.length" class="spreadsheet-preview-state">这个 Excel 没有可预览的工作表</div>
        <template v-else>
          <div class="spreadsheet-preview-tabs">
            <button
              v-for="sheet in workbookState.sheets"
              :key="sheet.name"
              type="button"
              :class="{ active: sheet.name === workbookState.activeSheet }"
              @click="selectSheet(sheet)"
            >
              {{ sheet.name }}
            </button>
          </div>
          <p v-if="workbookState.truncatedRows || workbookState.truncatedColumns" class="spreadsheet-preview-note">
            预览显示前 {{ MAX_PREVIEW_ROWS }} 行、{{ MAX_PREVIEW_COLUMNS }} 列；完整内容请下载查看。
          </p>
          <div class="spreadsheet-preview-table-wrap">
            <table class="spreadsheet-preview-table">
              <tbody>
                <tr v-for="(row, rowIndex) in activeRows" :key="rowIndex">
                  <th>{{ rowIndex + 1 }}</th>
                  <td
                    v-for="columnIndex in activeColumnCount"
                    :key="columnIndex"
                    :title="row[columnIndex - 1] || ''"
                  >
                    {{ row[columnIndex - 1] || '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
      <iframe
        v-else
        class="file-preview-frame"
        :src="previewUrl"
        :title="file?.filename"
      />
    </div>
  </BaseModal>
</template>
