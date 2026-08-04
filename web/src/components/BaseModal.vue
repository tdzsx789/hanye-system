<script setup>
import IconSvg from "./IconSvg.vue";

defineProps({
  open: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ""
  },
  meta: {
    type: String,
    default: ""
  },
  backdropClass: {
    type: [String, Array, Object],
    default: ""
  },
  cardClass: {
    type: [String, Array, Object],
    default: ""
  },
  bodyClass: {
    type: [String, Array, Object],
    default: ""
  },
  closeLabel: {
    type: String,
    default: "关闭"
  },
  showDefaultClose: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["close"]);
</script>

<template>
  <div v-if="open" :class="['modal-backdrop', backdropClass]" @click.self="emit('close')">
    <section :class="['modal-card', cardClass]">
      <div class="modal-head">
        <slot name="head">
          <h2>
            {{ title }}
            <span v-if="meta" class="order-title-meta">{{ meta }}</span>
          </h2>
        </slot>
        <div class="modal-detail-actions">
          <slot name="headActions" />
          <button v-if="showDefaultClose" type="button" class="icon-btn" @click="emit('close')">
            <IconSvg name="close" />{{ closeLabel }}
          </button>
        </div>
      </div>
      <div :class="bodyClass">
        <slot />
      </div>
      <div v-if="$slots.actions" class="modal-actions">
        <slot name="actions" />
      </div>
    </section>
  </div>
</template>
