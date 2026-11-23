<script setup lang="ts">
import { ref } from 'vue'
import { DOWNLOAD_CONFIG } from '../../data/downloads'

const copiedKey = ref<string | null>(null)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copyCode(key: string, code: string) {
  try {
    await navigator.clipboard?.writeText(code)
    copiedKey.value = key
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copiedKey.value = null
    }, 1800)
  } catch {
    copiedKey.value = null
  }
}
</script>

<template>
  <section class="tp-download-center" aria-label="软件下载渠道">
    <div class="tp-version-bar">
      <div class="tp-version-info">
        <span class="tp-version-tag">当前版本 v{{ DOWNLOAD_CONFIG.version }}</span>
        <span class="tp-version-tip">点击下方渠道跳转下载页，网盘渠道将持续补充</span>
      </div>
      <a
        class="tp-all-releases"
        :href="DOWNLOAD_CONFIG.allReleasesUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        查看全部历史版本与更新日志 →
      </a>
    </div>

    <div class="tp-platform-grid">
      <article
        v-for="platform in DOWNLOAD_CONFIG.platforms"
        :key="platform.id"
        class="tp-platform-card"
      >
        <header class="tp-platform-header">
          <div class="tp-platform-title-row">
            <span class="tp-platform-icon" aria-hidden="true">
              <svg v-if="platform.id === 'windows'" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M3 5.5 10.5 4.4v7.1H3V5.5Zm8.5-1.3L21 2.8v8.7h-9.5V4.2ZM3 12.5h7.5v7.1L3 18.5v-6Zm8.5 0H21v8.7l-9.5-1.4v-7.3Z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.33c.68-.83 1.14-1.98 1.01-3.13-.98.04-2.17.65-2.87 1.48-.62.72-1.17 1.89-1.02 3.01 1.09.08 2.2-.53 2.88-1.36Z" />
              </svg>
            </span>
            <div>
              <h3 class="tp-platform-name">{{ platform.name }}</h3>
              <p class="tp-platform-subtitle">{{ platform.subtitle }}</p>
            </div>
          </div>
          <code class="tp-file-hint">{{ platform.fileHint }}</code>
        </header>

        <ul class="tp-channel-list">
          <li
            v-for="(channel, idx) in platform.channels"
            :key="channel.name"
            class="tp-channel-item"
            :class="{ 'is-disabled': !channel.url }"
          >
            <div class="tp-channel-main">
              <div class="tp-channel-name-row">
                <span class="tp-channel-name">{{ channel.name }}</span>
                <span v-if="channel.badge" class="tp-badge">{{ channel.badge }}</span>
              </div>
              <p v-if="channel.note" class="tp-channel-note">{{ channel.note }}</p>
            </div>

            <div class="tp-channel-actions">
              <button
                v-if="channel.url && channel.code"
                type="button"
                class="tp-code-btn"
                :title="`点击复制提取码 ${channel.code}`"
                @click="copyCode(`${platform.id}-${idx}`, channel.code)"
              >
                {{
                  copiedKey === `${platform.id}-${idx}`
                    ? '已复制'
                    : `提取码：${channel.code}`
                }}
              </button>

              <a
                v-if="channel.url"
                class="tp-download-btn"
                :href="channel.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                前往下载 ↗
              </a>
              <span v-else class="tp-placeholder-pill">即将补充</span>
            </div>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.tp-download-center {
  margin: 20px 0 28px;
}

.tp-version-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background-color: var(--vp-c-bg-soft);
}

.tp-version-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.tp-version-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
}

.tp-version-tip {
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.tp-all-releases {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.tp-all-releases:hover {
  text-decoration: underline;
}

.tp-platform-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 768px) {
  .tp-platform-grid {
    grid-template-columns: 1fr;
  }
}

.tp-platform-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background-color: var(--vp-c-bg-soft);
}

.tp-platform-header {
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.tp-platform-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.tp-platform-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
  flex-shrink: 0;
}

.tp-platform-name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.tp-platform-subtitle {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.tp-file-hint {
  display: inline-block;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  background-color: var(--vp-c-bg-alt);
  word-break: break-all;
}

.tp-channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tp-channel-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background-color: var(--vp-c-bg);
}

.tp-channel-item.is-disabled {
  background-color: var(--vp-c-bg-alt);
  border-style: dashed;
}

.tp-channel-main {
  min-width: 0;
  flex: 1 1 160px;
}

.tp-channel-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tp-channel-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.tp-channel-item.is-disabled .tp-channel-name {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.tp-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
}

.tp-channel-note {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.tp-channel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tp-code-btn {
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background-color: var(--vp-c-bg-soft);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.tp-code-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.tp-download-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--vp-c-brand-1);
  text-decoration: none;
  transition: background-color 0.2s;
}

.tp-download-btn:hover {
  background-color: var(--vp-c-brand-2);
  color: #ffffff;
  text-decoration: none;
}

.tp-placeholder-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}
</style>
