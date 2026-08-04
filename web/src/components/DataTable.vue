<script setup>
defineProps({
  columns: {
    type: Array,
    default: () => []
  },
  rows: {
    type: Array,
    default: () => []
  },
  rowKey: {
    type: [String, Function],
    default: "id"
  },
  tableClass: {
    type: [String, Array, Object],
    default: ""
  },
  emptyText: {
    type: String,
    default: "暂无数据"
  }
});

const emit = defineEmits(["rowDblclick"]);

function resolveRowKey(row, index, rowKey) {
  if (typeof rowKey === "function") return rowKey(row, index);
  return row?.[rowKey] ?? index;
}
</script>

<template>
  <table :class="['data-table compact', tableClass]">
    <thead>
      <tr>
        <th
          v-for="column in columns"
          :key="column.key"
          :class="column.headerClass"
          :style="column.width ? { width: `${column.width}px` } : undefined"
        >
          {{ column.label }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(row, index) in rows"
        :key="resolveRowKey(row, index, rowKey)"
        @dblclick="emit('rowDblclick', row)"
      >
        <td v-for="column in columns" :key="column.key" :class="column.cellClass">
          <slot
            :name="`cell-${column.key}`"
            :row="row"
            :column="column"
            :value="row?.[column.key]"
            :index="index"
          >
            {{ row?.[column.key] || '-' }}
          </slot>
        </td>
      </tr>
      <tr v-if="rows.length === 0">
        <td :colspan="Math.max(columns.length, 1)">{{ emptyText }}</td>
      </tr>
    </tbody>
  </table>
</template>
