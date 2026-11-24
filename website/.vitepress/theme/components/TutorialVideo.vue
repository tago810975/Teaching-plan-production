<script setup lang="ts">
import { computed } from 'vue'
import { TUTORIAL_VIDEOS, resolveMediaUrl, type TutorialVideoId } from '../../data/videos'

const props = defineProps<{
  id: TutorialVideoId
  title?: string
  description?: string
}>()

const item = computed(() => TUTORIAL_VIDEOS[props.id])
const displayTitle = computed(() => props.title || item.value.title)
const displayDesc = computed(() => props.description || item.value.description)
const videoUrl = computed(() => resolveMediaUrl(item.value.file))
const posterUrl = computed(() => resolveMediaUrl(item.value.poster))
</script>

<template>
  <figure class="tp-video-card">
    <figcaption class="tp-video-header">
      <div class="tp-video-meta">
        <span class="tp-video-badge">视频教程</span>
        <span class="tp-video-title">{{ displayTitle }}</span>
        <span v-if="item.duration" class="tp-video-duration">{{ item.duration }}</span>
      </div>
      <a
        v-if="videoUrl"
        class="tp-video-open"
        :href="videoUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        新窗口打开 ↗
      </a>
    </figcaption>

    <div v-if="videoUrl" class="tp-video-stage">
      <video
        class="tp-video-player"
        controls
        preload="metadata"
        playsinline
        :src="videoUrl"
        :poster="posterUrl || undefined"
      >
        您的浏览器暂不支持内嵌视频播放，请点击右上角“新窗口打开”观看。
      </video>
    </div>

    <div v-else class="tp-video-placeholder">
      <div class="tp-placeholder-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M8 5.14v14l11-7-11-7Z" />
        </svg>
      </div>
      <p class="tp-placeholder-status">视频教程即将上线</p>
      <p class="tp-placeholder-desc">{{ displayDesc }}</p>
    </div>
  </figure>
</template>

<style scoped>
.tp-video-card {
  margin: 16px 0 22px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background-color: var(--vp-c-bg-soft);
}

.tp-video-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.tp-video-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tp-video-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
  flex-shrink: 0;
}

.tp-video-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.tp-video-duration {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.tp-video-open {
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  flex-shrink: 0;
}

.tp-video-open:hover {
  text-decoration: underline;
}

.tp-video-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #0b0f12;
}

.tp-video-player {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.tp-video-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 36px 20px;
  background-color: var(--vp-c-bg-alt);
}

.tp-placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 10px;
  border-radius: 50%;
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
}

.tp-placeholder-status {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.tp-placeholder-desc {
  margin: 6px 0 0;
  max-width: 540px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
</style>
