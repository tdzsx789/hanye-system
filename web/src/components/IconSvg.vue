<script setup>
import { computed } from "vue";

const ICON_PATHS = {
  archive: "M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M1 3h22v5H1zM10 12h4",
  back: "M19 12H5M12 19l-7-7 7-7",
  alignCenter: "M7 6h10M4 10h16M7 14h10M4 18h16",
  alignLeft: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignRight: "M4 6h16M10 10h10M4 14h16M10 18h10",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  car: "M5 17h14M6 17l1-7h10l1 7M8 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M16 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M8 10l2-4h4l2 4",
  check: "M20 6 9 17l-5-5",
  checklist: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronUp: "M6 15l6-6 6 6",
  close: "M18 6 6 18M6 6l12 12",
  contacts: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0M18 3h3v6h-3M3 3h3v6H3",
  copy: "M8 8h12v12H8zM4 16V4h12",
  database: "M4 6c0-2 4-4 8-4s8 2 8 4-4 4-8 4-8-2-8-4ZM4 6v6c0 2 4 4 8 4s8-2 8-4V6M4 12v6c0 2 4 4 8 4s8-2 8-4v-6",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  finance: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  minus: "M5 12h14",
  paperclip: "M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8",
  plus: "M12 5v14M5 12h14",
  refresh: "M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18 3v5h-5M6 21v-5h5",
  restore: "M3 7v6h6M21 17a9 9 0 0 1-15-6.7L3 13M21 7v10h-4",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 1 1 0 11H11",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM7 3v6h8M7 21v-8h10",
  search: "M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4",
  sparkles: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3ZM5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14ZM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  truck: "M3 7h11v10H3zM14 11h4l3 3v3h-7zM7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  user: "M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  userPlus: "M16 21a7 7 0 0 0-14 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6",
  users: "M17 21a5 5 0 0 0-10 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21a4 4 0 0 0-3-3.9M17 3.3a4 4 0 0 1 0 7.4"
};

const props = defineProps({
  name: {
    type: String,
    required: true
  }
});

const iconPath = computed(() => ICON_PATHS[props.name] || ICON_PATHS.list);
</script>

<template>
  <svg
    class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="iconPath" />
  </svg>
</template>
