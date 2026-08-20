<script setup>
import { computed, ref, watch } from "vue";
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

const emit = defineEmits(["close", "download"]);

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
  () => {
    if (props.open && isSpreadsheet.value) {
      loadSpreadsheetPreview();
      return;
    }
    workbookState.value = { loading: false, error: "", sheets: [], activeSheet: "", truncatedRows: 0, truncatedColumns: 0 };
  },
  { immediate: true }
);
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
    <div
      class="file-preview-stage"
      :class="{ 'is-image': isImage, 'is-frame': !isImage && !isSpreadsheet, 'is-spreadsheet': isSpreadsheet }"
    >
      <img
        v-if="isImage"
        class="file-preview-image"
        :src="previewUrl"
        :alt="file?.filename"
      />
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
