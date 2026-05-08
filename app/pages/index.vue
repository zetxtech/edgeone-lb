<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
    <main class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <section class="mb-8 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-400">EdgeOne</p>
          <h1 class="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Load Balancer Admin</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Manage domains, backend targets, HTTPS redirects, and health check paths for your EdgeOne Pages load balancer.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            @click="exportConfig"
            class="inline-flex items-center gap-2 rounded-xl border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Export Rules
          </button>
          <button
            @click="showAddDomain = true"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Domain
          </button>
        </div>
      </section>

      <section class="mb-8 rounded-2xl border-cyan-500/20 bg-slate-800/50 p-5 backdrop-blur-sm">
        <div class="mb-1 text-xs font-medium uppercase tracking-[0.25em] text-cyan-400">Update All Health Checks</div>
        <p class="mb-4 text-sm text-slate-400">
          Trigger health checks for all configured domains and return the latest results.
        </p>
        <div
          tabindex="0"
          @click="copyToClipboard(globalTriggerHealthCheckUrl)"
          @keydown.enter.prevent="copyToClipboard(globalTriggerHealthCheckUrl)"
          @keydown.space.prevent="copyToClipboard(globalTriggerHealthCheckUrl)"
          class="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border-cyan-500/20 bg-cyan-500/5 px-4 py-3 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
          :title="`Copy: ${globalTriggerHealthCheckUrl}`"
        >
          <code class="min-w-0 flex-1 truncate font-mono text-sm text-cyan-300">{{ globalTriggerHealthCheckUrl }}</code>
          <span class="shrink-0 text-xs font-medium text-cyan-400 transition group-hover:text-cyan-300">Copy</span>
        </div>
      </section>

      <section class="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Domains</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ Object.keys(rules).length }}</div>
        </div>
        <div class="rounded-2xl border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Targets</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ totalTargets }}</div>
        </div>
        <div class="rounded-2xl border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">HTTPS Redirects</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ forceHttpsCount }}</div>
        </div>
        <div class="rounded-2xl border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Health Endpoints</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ Object.keys(rules).length }}</div>
        </div>
      </section>

      <section class="mb-8 rounded-2xl border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div class="text-xs font-medium uppercase tracking-[0.25em] text-fuchsia-400">Debug Logs</div>
            <p class="mt-2 max-w-2xl text-sm text-slate-400">
              Requests with a User-Agent or request header containing <code class="font-mono text-fuchsia-300">EdgeoneLBDebugger</code> will appear here after the request fully ends.
            </p>
          </div>
          <button
            @click="loadDebugLogs"
            :disabled="debugLogsLoading"
            class="inline-flex items-center justify-center rounded-xl border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-3 text-sm font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ debugLogsLoading ? 'Refreshing...' : 'Refresh Logs' }}
          </button>
        </div>

        <div v-if="debugLogsError" class="mt-4 rounded-xl border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {{ debugLogsError }}
        </div>

        <div v-else-if="debugLogs.length > 0" class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div class="space-y-3">
            <button
              v-for="item in debugLogs"
              :key="item.id"
              type="button"
              @click="selectDebugLog(item.id)"
              :class="[
                'w-full rounded-xl border px-4 py-3 text-left transition',
                selectedDebugLogId === item.id
                  ? 'border-fuchsia-400/40 bg-fuchsia-500/10'
                  : 'border-slate-700/50 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-900/70'
              ]"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="font-mono text-sm text-white">{{ item.request?.method || 'UNKNOWN' }} {{ item.request?.pathname || '/' }}</div>
                <span :class="getOutcomeBadgeClass(item.outcome)" class="rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.2em]">
                  {{ item.outcome || 'unknown' }}
                </span>
              </div>
              <div class="mt-2 text-xs text-slate-400">{{ item.request?.hostname || 'Unknown host' }}</div>
              <div class="mt-2 flex-wrap gap-3 text-xs text-slate-500">
                <span>Status: {{ item.response?.status ?? '-' }}</span>
                <span>Phase: {{ item.phase || '-' }}</span>
                <span>Logs: {{ item.logCount ?? 0 }}</span>
                <span>{{ formatDateTime(item.completedAt || item.createdAt) }}</span>
              </div>
            </button>
          </div>

          <div class="rounded-xl border-slate-700/50 bg-slate-900/50 p-4">
            <template v-if="selectedDebugLog">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div class="font-mono text-sm text-white">{{ selectedDebugLog.request?.method || 'UNKNOWN' }} {{ selectedDebugLog.request?.url || '' }}</div>
                  <div class="mt-1 text-xs text-slate-400">ID: {{ selectedDebugLog.id }}</div>
                </div>
                <span :class="getOutcomeBadgeClass(selectedDebugLog.outcome)" class="rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.2em]">
                  {{ selectedDebugLog.outcome || 'unknown' }}
                </span>
              </div>

              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <div class="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                  <div class="mb-1 text-slate-500">Response</div>
                  <div>Status: {{ selectedDebugLog.response?.status ?? '-' }} {{ selectedDebugLog.response?.statusText || '' }}</div>
                  <div class="mt-1">Duration: {{ selectedDebugLog.durationMs ?? '-' }} ms</div>
                  <div class="mt-1">Phase: {{ selectedDebugLog.phase || '-' }}</div>
                </div>
                <div class="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                  <div class="mb-1 text-slate-500">Trigger</div>
                  <div>Header: {{ selectedDebugLog.request?.debugRequestedByHeader ? 'Yes' : 'No' }}</div>
                  <div class="mt-1">User-Agent: {{ selectedDebugLog.request?.debugRequestedByUserAgent ? 'Yes' : 'No' }}</div>
                  <div class="mt-1">Kind: {{ selectedDebugLog.kind || '-' }}</div>
                </div>
              </div>

              <div class="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Full Record</div>
              <pre class="mt-3 max-h-[32rem] overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">{{ formatDebugLog(selectedDebugLog) }}</pre>
            </template>
            <div v-else class="flex min-h-[12rem] items-center justify-center text-sm text-slate-500">
              Select a debug log to inspect details.
            </div>
          </div>
        </div>

        <div v-else-if="!debugLogsLoading" class="mt-4 rounded-xl border-slate-700/50 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-500">
          No debug logs yet.
        </div>
      </section>

      <section class="space-y-4">
        <div
          v-for="(rule, domain) in rules"
          :key="domain"
          class="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm transition hover:border-slate-600/50"
        >
          <div class="border-b border-slate-700/50 px-6 py-5">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="mb-3 flex items-center gap-3">
                  <div class="h-2 w-2 rounded-full bg-emerald-400"></div>
                  <h2 class="truncate font-mono text-lg font-semibold text-white">{{ domain }}</h2>
                </div>

                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <span class="inline-flex items-center gap-1.5 rounded border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-400">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    </svg>
                    EdgeOne
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {{ rule.forceHttps ? 'HTTPS Forced' : 'HTTPS Optional' }}
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Backend Health: {{ rule.healthPath }}
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14-7H5m14 14H5" />
                    </svg>
                    {{ rule.targets.length }} Targets
                  </span>
                </div>

                <div class="rounded-xl border-slate-700/40 bg-slate-900/50 p-3">
                  <div class="mb-3 text-xs text-slate-400">Health Check URLs</div>
                  <div class="space-y-3">
                    <div>
                      <div class="mb-1 text-[11px] uppercase tracking-[0.2em] text-emerald-400">Cached Status</div>
                      <p class="mb-2 text-xs text-slate-500">Shows the current cached health result.</p>
                      <div
                        tabindex="0"
                        @click="copyToClipboard(`https://${domain}/_health`)"
                        @keydown.enter.prevent="copyToClipboard(`https://${domain}/_health`)"
                        @keydown.space.prevent="copyToClipboard(`https://${domain}/_health`)"
                        class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border-emerald-500/20 bg-emerald-500/5 px-3 py-2 transition hover:border-emerald-400/40 hover:bg-emerald-500/10"
                        :title="`Copy: https://${domain}/_health`"
                      >
                        <code class="min-w-0 flex-1 truncate font-mono text-xs text-emerald-300">https://{{ domain }}/_health</code>
                        <span class="shrink-0 text-[11px] font-medium text-emerald-400 transition group-hover:text-emerald-300">Copy</span>
                      </div>
                    </div>
                    <div>
                      <div class="mb-1 text-[11px] uppercase tracking-[0.2em] text-cyan-400">Trigger And Refresh</div>
                      <p class="mb-2 text-xs text-slate-500">Triggers a new health check and returns the latest result.</p>
                      <div
                        tabindex="0"
                        @click="copyToClipboard(`https://${domain}/_trigger_health_check`)"
                        @keydown.enter.prevent="copyToClipboard(`https://${domain}/_trigger_health_check`)"
                        @keydown.space.prevent="copyToClipboard(`https://${domain}/_trigger_health_check`)"
                        class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border-cyan-500/20 bg-cyan-500/5 px-3 py-2 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
                        :title="`Copy: https://${domain}/_trigger_health_check`"
                      >
                        <code class="min-w-0 flex-1 truncate font-mono text-xs text-cyan-300">https://{{ domain }}/_trigger_health_check</code>
                        <span class="shrink-0 text-[11px] font-medium text-cyan-400 transition group-hover:text-cyan-300">Copy</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 lg:ml-4">
                <button
                  @click="editDomain(domain)"
                  class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
                  title="Edit"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  @click="deleteDomain(domain)"
                  class="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
                  title="Delete"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div class="px-6 py-4">
            <div class="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Backend Targets</div>
            <div class="space-y-2">
              <div
                v-for="(target, idx) in rule.targets"
                :key="idx"
                class="group flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2"
              >
                <div class="flex items-center gap-3">
                  <span :class="getTypeBadgeClass(target.type)" class="rounded px-2 py-0.5 text-xs font-medium uppercase">
                    {{ target.type }}
                  </span>
                  <code class="font-mono text-sm text-slate-300">{{ target.host }}</code>
                </div>
                <button
                  @click="removeTarget(domain, idx)"
                  class="p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                  title="Remove target"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div v-if="rule.targets.length === 0" class="py-4 text-center text-sm text-slate-500">
                No targets configured
              </div>
            </div>

            <button
              @click="openAddTarget(domain)"
              class="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-sm text-slate-400 transition hover:bg-slate-700/30 hover:text-cyan-400"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add Target
            </button>
          </div>
        </div>

        <div v-if="Object.keys(rules).length === 0" class="rounded-2xl border border-slate-700/50 bg-slate-800/40 px-6 py-16 text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800/50">
            <svg class="h-8 w-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <h3 class="mb-2 text-lg font-medium text-slate-300">No domains configured</h3>
          <p class="mb-4 text-sm text-slate-500">Get started by adding your first domain.</p>
          <button
            @click="showAddDomain = true"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Domain
          </button>
        </div>
      </section>
    </main>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddDomain" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeAddDomain"></div>
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-6 text-xl font-semibold text-white">{{ editingDomain ? 'Edit Domain' : 'Add Domain' }}</h3>
            <form @submit.prevent="saveDomain" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Domain</label>
                <input
                  v-model="domainForm.domain"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="api.example.com"
                />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Health Check Path</label>
                <input
                  v-model="domainForm.healthPath"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="/"
                />
                <p class="mt-1 text-xs text-slate-500">Path used for backend health checks, for example /health.</p>
              </div>
              <label class="group flex cursor-pointer items-center gap-3">
                <div class="relative">
                  <input v-model="domainForm.forceHttps" type="checkbox" class="peer sr-only" />
                  <div class="h-6 w-11 rounded-full bg-slate-700 transition-colors peer-checked:bg-cyan-500"></div>
                  <div class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-slate-300 transition group-hover:text-white">Force HTTPS Redirect</span>
              </label>
              <div class="flex gap-3 pt-4">
                <button
                  type="button"
                  @click="closeAddDomain"
                  class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
                >
                  {{ editingDomain ? 'Save Changes' : 'Add Domain' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddTarget" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showAddTarget = false"></div>
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-2 text-xl font-semibold text-white">Add Target</h3>
            <p class="mb-6 text-sm text-slate-400">Add a backend target for <code class="text-cyan-400">{{ targetDomain }}</code></p>
            <form @submit.prevent="saveTarget" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Host</label>
                <input
                  v-model="targetForm.host"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 font-mono text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="backend.example.com:443"
                />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Type</label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    @click="targetForm.type = 'frp'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'frp'
                        ? 'border-purple-500/50 bg-purple-500/20 text-purple-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    FRP
                  </button>
                  <button
                    type="button"
                    @click="targetForm.type = 'tunnel'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'tunnel'
                        ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    Tunnel
                  </button>
                  <button
                    type="button"
                    @click="targetForm.type = 'direct'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'direct'
                        ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    Direct
                  </button>
                </div>
              </div>
              <div class="flex gap-3 pt-4">
                <button
                  type="button"
                  @click="showAddTarget = false"
                  class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
                >
                  Add Target
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
const rules = ref({})

const showAddDomain = ref(false)
const showAddTarget = ref(false)
const editingDomain = ref(null)
const targetDomain = ref('')
const debugLogs = ref([])
const debugLogsLoading = ref(false)
const debugLogsError = ref('')
const selectedDebugLogId = ref('')
const selectedDebugLog = ref(null)

const domainForm = ref({
  domain: '',
  healthPath: '/',
  forceHttps: true,
})

const targetForm = ref({
  host: '',
  type: 'frp',
})

const requestUrl = useRequestURL()

const totalTargets = computed(() => {
  return Object.values(rules.value).reduce((sum, rule) => sum + (rule.targets?.length || 0), 0)
})

const forceHttpsCount = computed(() => {
  return Object.values(rules.value).filter((rule) => rule.forceHttps).length
})

const globalTriggerHealthCheckUrl = computed(() => {
  return new URL('/_trigger_health_check', requestUrl.origin).toString()
})

onMounted(async () => {
  await loadRules()
  await loadDebugLogs()
})

async function loadRules() {
  try {
    rules.value = await $fetch('/api/rules')
  } catch (e) {
    console.error('Failed to load rules:', e)
  }
}

async function loadDebugLogs() {
  debugLogsLoading.value = true
  debugLogsError.value = ''

  try {
    const response = await $fetch('/api/logs')
    debugLogs.value = Array.isArray(response?.items) ? response.items : []

    if (debugLogs.value.length === 0) {
      selectedDebugLogId.value = ''
      selectedDebugLog.value = null
      return
    }

    const nextId = selectedDebugLogId.value && debugLogs.value.some((item) => item.id === selectedDebugLogId.value)
      ? selectedDebugLogId.value
      : debugLogs.value[0].id

    await selectDebugLog(nextId)
  } catch (e) {
    console.error('Failed to load debug logs:', e)
    debugLogsError.value = e?.data?.error || e?.message || 'Failed to load debug logs'
  } finally {
    debugLogsLoading.value = false
  }
}

async function selectDebugLog(id) {
  if (!id) {
    selectedDebugLogId.value = ''
    selectedDebugLog.value = null
    return
  }

  debugLogsError.value = ''
  selectedDebugLogId.value = id

  try {
    selectedDebugLog.value = await $fetch('/api/logs', {
      query: { id },
    })
  } catch (e) {
    console.error('Failed to load debug log detail:', e)
    debugLogsError.value = e?.data?.error || e?.message || 'Failed to load debug log detail'
  }
}

async function saveDomain() {
  if (!domainForm.value.domain) return

  try {
    const isRename = editingDomain.value && editingDomain.value !== domainForm.value.domain

    await $fetch('/api/rules', {
      method: 'POST',
      body: {
        domain: domainForm.value.domain,
        oldDomain: isRename ? editingDomain.value : undefined,
        rule: {
          forceHttps: domainForm.value.forceHttps,
          healthPath: domainForm.value.healthPath,
          targets: editingDomain.value ? rules.value[editingDomain.value].targets : [],
          platform: 'edgeone',
        },
      },
    })
    await loadRules()
    closeAddDomain()
  } catch (e) {
    console.error('Failed to save domain:', e)
    alert('Failed to save domain: ' + e.message)
  }
}

function editDomain(domain) {
  editingDomain.value = domain
  domainForm.value = {
    domain,
    healthPath: rules.value[domain].healthPath,
    forceHttps: rules.value[domain].forceHttps,
  }
  showAddDomain.value = true
}

function closeAddDomain() {
  showAddDomain.value = false
  editingDomain.value = null
  domainForm.value = { domain: '', healthPath: '/', forceHttps: true }
}

async function deleteDomain(domain) {
  if (!confirm(`Delete domain "${domain}"?`)) return

  try {
    await $fetch(`/api/rules/${encodeURIComponent(domain)}`, { method: 'DELETE' })
    await loadRules()
  } catch (e) {
    console.error('Failed to delete domain:', e)
  }
}

function openAddTarget(domain) {
  targetDomain.value = domain
  targetForm.value = { host: '', type: 'frp' }
  showAddTarget.value = true
}

async function saveTarget() {
  if (!targetForm.value.host) return

  try {
    await $fetch(`/api/rules/${encodeURIComponent(targetDomain.value)}/targets`, {
      method: 'POST',
      body: targetForm.value,
    })
    await loadRules()
    showAddTarget.value = false
  } catch (e) {
    console.error('Failed to add target:', e)
  }
}

async function removeTarget(domain, index) {
  try {
    await $fetch(`/api/rules/${encodeURIComponent(domain)}/targets/${index}`, {
      method: 'DELETE',
    })
    await loadRules()
  } catch (e) {
    console.error('Failed to remove target:', e)
  }
}

function getTypeBadgeClass(type) {
  const classes = {
    frp: 'border border-purple-500/30 bg-purple-500/20 text-purple-300',
    tunnel: 'border border-blue-500/30 bg-blue-500/20 text-blue-300',
    direct: 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300',
  }
  return classes[type] || 'border border-slate-500/30 bg-slate-500/20 text-slate-300'
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    console.error('Failed to copy:', e)
  }
}

function getOutcomeBadgeClass(outcome) {
  const classes = {
    success: 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300',
    redirect: 'border border-cyan-500/30 bg-cyan-500/20 text-cyan-300',
    'client-error': 'border border-amber-500/30 bg-amber-500/20 text-amber-300',
    'server-error': 'border border-red-500/30 bg-red-500/20 text-red-300',
    unknown: 'border border-slate-500/30 bg-slate-500/20 text-slate-300',
  }

  return classes[outcome] || classes.unknown
}

function formatDateTime(value) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString()
}

function formatDebugLog(log) {
  return JSON.stringify(log, null, 2)
}

async function exportConfig() {
  try {
    const response = await fetch('/api/export')
    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`)
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'edgeone-lb-rules.json'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Failed to export rules:', e)
  }
}
</script>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95) translateY(10px);
}
</style>
