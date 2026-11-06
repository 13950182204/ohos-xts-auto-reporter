window.__ModuleLoader__.load({
	id: 'ohos-xts-auto-reporter',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    //#region src/settings-view.ts
    const TOKENS = `
    .oh-xts{--oh-border:var(--dsw-alias-border-l2,var(--dsw-color-border,#cfd3d6));--oh-border-soft:var(--dsw-alias-border-l1,var(--dsw-color-border,#e1e5ee));--oh-text:var(--dsw-alias-label-primary,var(--dsw-color-text,inherit));--oh-text-2:var(--dsw-alias-label-secondary,var(--dsw-color-text-secondary,#61666b));--oh-text-3:var(--dsw-alias-label-tertiary,#81858c);--oh-soft:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.1));--oh-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));--oh-primary:var(--dsw-alias-button-primary-fill,var(--dsw-color-primary,#2563eb));--oh-primary-hover:var(--dsw-alias-button-primary-hover,var(--dsw-color-primary,#2563eb));--oh-on-primary:var(--dsw-alias-label-primary-foreground,#fff);--oh-danger:var(--dsw-alias-state-error-primary,var(--dsw-color-danger,#dc2626));--oh-success:var(--dsw-alias-state-success-primary,#22c55e);--oh-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--oh-business:var(--dsw-alias-state-business-primary,#4176e6);--oh-radius:var(--dsw-radius-md,8px);--oh-radius-sm:var(--dsw-radius-sm,6px);--oh-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;--oh-focus:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6))}
    .oh-xts,.oh-xts *{box-sizing:border-box}
    .oh-xts{display:grid;gap:16px;max-width:780px;padding:18px 18px 16px;border:1px solid var(--oh-border-soft);border-radius:var(--dsw-radius-lg,10px);color:var(--oh-text);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.55}
    .oh-xts__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 12px}
    .oh-xts__title{margin:0;font-size:15px;font-weight:600;letter-spacing:.01em}
    .oh-xts__head-note{font-size:11.5px;color:var(--oh-text-3)}
    .oh-xts__section{display:grid;gap:12px}
    .oh-xts__section-head{display:grid;gap:4px}
    .oh-xts__section-title{margin:0;font-size:13px;font-weight:600}
    .oh-xts__desc{margin:0;max-width:68ch;font-size:12px;line-height:1.6;color:var(--oh-text-2);overflow-wrap:anywhere}
    .oh-xts__rule{height:1px;border:0;margin:0;background:var(--oh-border-soft)}
    .oh-xts__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(216px,1fr));gap:12px 16px;align-items:start}
    .oh-xts__field{display:grid;gap:6px;margin:0;min-width:0}
    .oh-xts__field--wide{grid-column:1/-1}
    .oh-xts__label{font-size:12px;font-weight:500;color:var(--oh-text-2)}
    .oh-xts__hint{font-size:11px;line-height:1.5;color:var(--oh-text-3)}
    .oh-xts__input{width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--oh-border);border-radius:var(--oh-radius-sm);background:var(--oh-soft);color:inherit;font:inherit;transition:border-color .15s ease}
    .oh-xts__input::placeholder{color:var(--oh-text-3)}
    .oh-xts__input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,var(--oh-border))}
    .oh-xts__input:focus-visible{outline:2px solid var(--oh-focus);outline-offset:1px}
    .oh-xts__input:disabled{opacity:.6;cursor:not-allowed}
    .oh-xts__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .oh-xts__btn{height:32px;padding:0 12px;border:1px solid var(--oh-border);border-radius:var(--oh-radius-sm);background:transparent;color:var(--oh-text);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,opacity .15s ease}
    .oh-xts__btn:hover:not(:disabled){background:var(--oh-hover)}
    .oh-xts__btn:focus-visible{outline:2px solid var(--oh-focus);outline-offset:2px}
    .oh-xts__btn:disabled{opacity:.5;cursor:not-allowed}
    .oh-xts__btn--primary{border-color:transparent;background:var(--oh-primary);color:var(--oh-on-primary)}
    .oh-xts__btn--primary:hover:not(:disabled){background:var(--oh-primary-hover);opacity:.92}
    .oh-xts__note{margin:0;max-width:70ch;font-size:11.5px;line-height:1.6;color:var(--oh-text-3);overflow-wrap:anywhere}
    .oh-xts__panel{display:grid;gap:10px;padding:12px;border:1px solid var(--oh-border-soft);border-radius:var(--oh-radius)}
    .oh-xts__panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px}
    .oh-xts__panel-title{font-size:12.5px;font-weight:600}
    .oh-xts__panel-meta{font-size:11.5px;color:var(--oh-text-3);overflow-wrap:anywhere}
    .oh-xts__list{display:grid;gap:6px;margin:0;padding:0;list-style:none}
    .oh-xts__row{display:grid;gap:3px;padding:8px 10px;border:1px solid var(--oh-border-soft);border-left:2px solid transparent;border-radius:var(--oh-radius-sm);background:var(--oh-soft)}
    .oh-xts__row--blocked{border-left-color:var(--oh-danger)}
    .oh-xts__row--ready{border-left-color:var(--oh-success)}
    .oh-xts__row-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
    .oh-xts__name{font-size:12.5px;font-weight:500;overflow-wrap:anywhere;min-width:0}
    .oh-xts__path{margin:0;font-family:var(--oh-mono);font-size:11px;line-height:1.5;color:var(--oh-text-3);overflow-wrap:anywhere}
    .oh-xts__problem{margin:0;font-size:11.5px;line-height:1.5;color:var(--oh-danger);overflow-wrap:anywhere}
    .oh-xts__chip{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.16);font-size:10.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
    .oh-xts__chip--acts{color:var(--oh-business)}
    .oh-xts__chip--validator{color:var(--oh-success)}
    .oh-xts__chip--reserved{color:var(--oh-warn)}
    .oh-xts__chip--blocked{color:var(--oh-danger)}
    .oh-xts__chip--neutral{color:var(--oh-text-2)}
    .oh-xts__progress-top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;font-size:11.5px;color:var(--oh-text-2)}
    .oh-xts__bar{height:6px;border-radius:999px;background:rgba(127,127,127,.22);overflow:hidden}
    .oh-xts__bar>div{height:100%;border-radius:inherit;transition:width .2s ease-out}
    .oh-xts__status{display:grid;gap:2px;padding:8px 10px;border-left:2px solid var(--oh-border);border-radius:4px;background:var(--oh-soft);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
    .oh-xts__status--ok{border-left-color:var(--oh-success)}
    .oh-xts__status--error{border-left-color:var(--oh-danger)}
    .oh-xts__status--warn{border-left-color:var(--oh-warn)}
    .oh-xts__empty{margin:0;font-size:12px;color:var(--oh-text-3)}
    .oh-xts__muted{color:var(--oh-text-3)}
    @media (max-width:520px){.oh-xts{padding:14px}.oh-xts__grid{grid-template-columns:1fr}}
    @media (prefers-reduced-motion:reduce){.oh-xts *{transition:none!important}}
    `;
    function str(value) {
    	return typeof value === "string" ? value : "";
    }
    function num(value) {
    	const parsed = Number(value);
    	return Number.isFinite(parsed) ? parsed : void 0;
    }
    function asRecord(value) {
    	return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
    }
    function asArray(value) {
    	return Array.isArray(value) ? value : [];
    }
    function clampPercent(value) {
    	if (value === void 0) return void 0;
    	return Math.max(0, Math.min(100, value));
    }
    function categoryTone(category) {
    	if (category === "ACTS") return "acts";
    	if (category === "ACTS-Validator") return "validator";
    	if ([
    		"HATS",
    		"DCTS",
    		"SSTS"
    	].includes(category)) return "reserved";
    	return "neutral";
    }
    function itemTone(status) {
    	if (status === "saved" || status === "preflight") return "ready";
    	if (status === "blocked" || status === "retryable") return "blocked";
    	return "neutral";
    }
    function field(props) {
    	return (0, react.createElement)("label", {
    		className: props.wide ? "oh-xts__field oh-xts__field--wide" : "oh-xts__field",
    		htmlFor: props.id,
    		key: props.id
    	}, (0, react.createElement)("span", { className: "oh-xts__label" }, props.label), (0, react.createElement)("input", {
    		id: props.id,
    		className: "oh-xts__input",
    		type: props.type ?? "text",
    		value: props.value,
    		placeholder: props.placeholder,
    		autoComplete: props.autoComplete,
    		disabled: props.disabled,
    		readOnly: props.readOnly,
    		onChange: (event) => props.onChange(event.target.value)
    	}), props.hint ? (0, react.createElement)("span", { className: "oh-xts__hint" }, props.hint) : null);
    }
    function sectionHead(title, description) {
    	return (0, react.createElement)("div", {
    		className: "oh-xts__section-head",
    		key: `head-${title}`
    	}, (0, react.createElement)("h3", { className: "oh-xts__section-title" }, title), (0, react.createElement)("p", { className: "oh-xts__desc" }, description));
    }
    function chip(text, tone) {
    	return (0, react.createElement)("span", {
    		className: `oh-xts__chip oh-xts__chip--${tone}`,
    		key: `chip-${text}-${tone}`
    	}, text);
    }
    function scanSummaryMeta(summary, items) {
    	const parts = [];
    	const total = num(summary?.total) ?? items.length;
    	parts.push(`${total} 条`);
    	const byCategory = summary?.byCategory ?? {};
    	const categories = Object.entries(byCategory).filter(([, count]) => Number(count) > 0);
    	for (const [category, count] of categories) parts.push(`${category} ${Number(count)}`);
    	const blocked = num(summary?.blocked) ?? items.filter((item) => item.ready === false).length;
    	if (blocked > 0) parts.push(`待修复 ${blocked}`);
    	return parts.join(" · ");
    }
    function scanPanel(scan) {
    	const items = Array.isArray(scan.items) ? scan.items : [];
    	const visibleItems = items.slice(0, 8);
    	if (items.length === 0) return (0, react.createElement)("div", { className: "oh-xts__panel" }, (0, react.createElement)("div", { className: "oh-xts__panel-head" }, (0, react.createElement)("span", { className: "oh-xts__panel-title" }, "识别结果"), (0, react.createElement)("span", { className: "oh-xts__panel-meta" }, scan.root ?? "")), (0, react.createElement)("p", { className: "oh-xts__empty" }, scan.ok ? "这个路径下没有找到 .txt 豁免报告。" : scan.error || scan.message || "识别失败。"));
    	return (0, react.createElement)("div", {
    		className: "oh-xts__panel",
    		"aria-live": "polite"
    	}, (0, react.createElement)("div", { className: "oh-xts__panel-head" }, (0, react.createElement)("span", { className: "oh-xts__panel-title" }, "识别结果"), (0, react.createElement)("span", { className: "oh-xts__panel-meta" }, scanSummaryMeta(scan.summary, items))), (0, react.createElement)("ul", { className: "oh-xts__list" }, visibleItems.map((item, index) => {
    		const category = str(item.testCategory);
    		const ready = item.ready !== false;
    		const problems = asArray(item.problems).map(str).filter(Boolean);
    		const name = item.moduleName && item.testsuite ? `${item.moduleName}#${item.testsuite}` : str(item.sourceReport);
    		return (0, react.createElement)("li", {
    			className: `oh-xts__row oh-xts__row--${ready ? "ready" : "blocked"}`,
    			key: `${str(item.sourceReport)}-${index}`
    		}, (0, react.createElement)("div", { className: "oh-xts__row-top" }, category ? chip(category, ready ? categoryTone(category) : "blocked") : null, (0, react.createElement)("span", { className: "oh-xts__name" }, name), (0, react.createElement)("span", { className: "oh-xts__muted" }, `${num(item.caseCount) ?? 0} 条用例`)), item.submissionPath ? (0, react.createElement)("p", { className: "oh-xts__path" }, `提交路径：${item.submissionPath}`) : null, problems.length > 0 ? (0, react.createElement)("p", { className: "oh-xts__problem" }, problems.join("；")) : null);
    	})), items.length > visibleItems.length ? (0, react.createElement)("p", { className: "oh-xts__muted" }, `另有 ${items.length - visibleItems.length} 条未列出（共 ${items.length} 条）；保存时会逐条处理，进度见下方批次面板。`) : null);
    }
    function progressPanel(busy, result, percent, stage, detail) {
    	if (percent === void 0) return null;
    	return (0, react.createElement)("div", { className: "oh-xts__panel" }, (0, react.createElement)("div", { className: "oh-xts__progress-top" }, (0, react.createElement)("span", null, stage || (busy ? "处理中" : "处理状态")), (0, react.createElement)("span", { className: "oh-xts__muted" }, `${Math.round(percent)}%`)), (0, react.createElement)("div", {
    		className: "oh-xts__bar",
    		role: "progressbar",
    		"aria-label": "XTS 报告上传进度",
    		"aria-valuemin": 0,
    		"aria-valuemax": 100,
    		"aria-valuenow": Math.round(percent)
    	}, (0, react.createElement)("div", { style: {
    		width: `${percent}%`,
    		background: result?.ok === false ? "var(--oh-danger)" : "var(--oh-business)"
    	} })), detail ? (0, react.createElement)("div", { className: "oh-xts__path" }, detail) : null);
    }
    function batchPanel(batch, batchItems, title, completed, taskCount) {
    	if (!batch || batchItems.length === 0) return null;
    	return (0, react.createElement)("div", { className: "oh-xts__panel" }, (0, react.createElement)("div", { className: "oh-xts__panel-head" }, (0, react.createElement)("span", { className: "oh-xts__panel-title" }, `${title}（${completed}/${taskCount}）`), (0, react.createElement)("span", { className: "oh-xts__panel-meta" }, str(batch.rootPath))), (0, react.createElement)("ul", { className: "oh-xts__list" }, batchItems.map((item, index) => {
    		const percent = clampPercent(num(item.percent)) ?? 0;
    		const status = str(item.status) || "pending";
    		const tone = itemTone(status);
    		const name = str(item.name) || str(item.directory) || `任务 ${index + 1}`;
    		const category = str(item.testCategory);
    		const submissionPath = str(item.submissionPath);
    		const note = [str(item.stage) || status, str(item.detail)].filter(Boolean).join("：");
    		return (0, react.createElement)("li", {
    			className: `oh-xts__row oh-xts__row--${tone}`,
    			key: `${str(item.workbookPath)}-${index}`
    		}, (0, react.createElement)("div", { className: "oh-xts__row-top" }, category ? chip(category, categoryTone(category)) : null, (0, react.createElement)("span", { className: "oh-xts__name" }, name), (0, react.createElement)("span", { className: "oh-xts__path" }, `${Math.round(percent)}%`)), (0, react.createElement)("div", {
    			className: "oh-xts__bar",
    			role: "progressbar",
    			"aria-label": `${name} 处理进度`,
    			"aria-valuemin": 0,
    			"aria-valuemax": 100,
    			"aria-valuenow": Math.round(percent)
    		}, (0, react.createElement)("div", { style: {
    			width: `${percent}%`,
    			background: tone === "blocked" ? "var(--oh-danger)" : "var(--oh-business)"
    		} })), note ? (0, react.createElement)("p", { className: tone === "blocked" ? "oh-xts__problem" : "oh-xts__path" }, note) : null, submissionPath ? (0, react.createElement)("p", { className: "oh-xts__path" }, submissionPath) : null);
    	})));
    }
    function SettingsCardView(props) {
    	const { values, result, state, scan, busy, scanning } = props;
    	const summaryState = state && !state.finishedAt && result ? {
    		...state,
    		finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    		ok: result.ok,
    		message: result.message,
    		batch: result.batch ?? state.batch
    	} : state;
    	const progress = asRecord(summaryState?.progress);
    	const percent = clampPercent(num(progress?.percent));
    	const stage = str(progress?.stage);
    	const detail = str(progress?.detail);
    	const batch = asRecord(summaryState?.batch ?? result?.batch);
    	const batchItems = asArray(batch?.items).map(asRecord).filter(Boolean);
    	const batchCompleted = batchItems.filter((item) => [
    		"saved",
    		"skipped",
    		"blocked",
    		"retryable",
    		"preflight"
    	].includes(str(item.status))).length;
    	const batchTotal = num(batch?.taskCount) ?? batchItems.length;
    	const batchTitle = str(summaryState?.kind) === "waiver" ? "批量豁免草稿进度" : "批量评测进度";
    	const firstResult = asArray(asRecord(result?.summary ?? summaryState?.summary)?.results).map(asRecord).filter(Boolean)[0];
    	const mirror = asRecord(asRecord(firstResult?.attachments)?.mirror);
    	const showProgress = percent !== void 0 && (busy || summaryState?.phase !== "idle" || Boolean(summaryState?.finishedAt) || Boolean(result));
    	const messages = [result?.message, ...result?.errors ?? []].filter(Boolean).join("\n");
    	const metaLines = [
    		str(firstResult?.applicationId) ? `申请标识 ${str(firstResult?.applicationId)}` : "",
    		str(firstResult?.assessmentNumber) ? `测评编号 ${str(firstResult?.assessmentNumber)}` : "",
    		str(firstResult?.status) ? `处理结果 ${str(firstResult?.status)}` : "",
    		str(mirror?.fileName) ? `镜像 ${str(mirror?.fileName)}` : ""
    	].filter(Boolean);
    	return (0, react.createElement)("section", {
    		className: "oh-xts",
    		"aria-busy": busy ? true : void 0
    	}, (0, react.createElement)("style", { key: "oh-xts-styles" }, TOKENS), (0, react.createElement)("header", { className: "oh-xts__head" }, (0, react.createElement)("h3", { className: "oh-xts__title" }, "OpenHarmony XTS 自动上报"), (0, react.createElement)("span", { className: "oh-xts__head-note" }, "评测资料 / 豁免草稿")), (0, react.createElement)("div", { className: "oh-xts__section" }, (0, react.createElement)("div", { className: "oh-xts__grid" }, field({
    		id: "oh-xts-username",
    		label: "账号",
    		value: values.username,
    		type: "text",
    		autoComplete: "username",
    		disabled: busy,
    		onChange: (value) => props.onChange("username", value)
    	}), field({
    		id: "oh-xts-password",
    		label: "密码",
    		value: values.password,
    		type: "password",
    		autoComplete: "current-password",
    		placeholder: props.hasPassword ? "已保存密码，留空则沿用" : "未保存密码",
    		disabled: busy,
    		onChange: (value) => props.onChange("password", value)
    	}), field({
    		id: "oh-xts-workbook",
    		label: "Excel 文件或批量目录",
    		wide: true,
    		value: values.workbookPath,
    		placeholder: "单个 Excel 或目录，例如 D:\\ohos\\XTS6.1\\DHong",
    		disabled: busy,
    		onChange: (value) => props.onChange("workbookPath", value)
    	}), field({
    		id: "oh-xts-mirror",
    		label: "镜像固件路径（预留）",
    		wide: true,
    		value: "",
    		placeholder: "未来固件自动上传，当前留空",
    		disabled: true,
    		readOnly: true,
    		onChange: () => {}
    	}), field({
    		id: "oh-xts-phone",
    		label: "企业联系电话",
    		value: values.contactPhone,
    		type: "tel",
    		disabled: busy,
    		onChange: (value) => props.onChange("contactPhone", value)
    	}), field({
    		id: "oh-xts-email",
    		label: "企业邮箱",
    		value: values.contactEmail,
    		type: "email",
    		disabled: busy,
    		onChange: (value) => props.onChange("contactEmail", value)
    	})), (0, react.createElement)("div", { className: "oh-xts__actions" }, (0, react.createElement)("button", {
    		type: "button",
    		className: "oh-xts__btn",
    		onClick: props.onPreflight,
    		disabled: busy
    	}, "评测资料预检"), (0, react.createElement)("button", {
    		type: "button",
    		className: "oh-xts__btn oh-xts__btn--primary",
    		onClick: props.onSaveReport,
    		disabled: busy
    	}, "评测资料提交"))), (0, react.createElement)("hr", { className: "oh-xts__rule" }), (0, react.createElement)("div", { className: "oh-xts__section" }, sectionHead("豁免资料", "从指定目录读取 .txt 豁免报告，按目录自动识别测试套分类、模块与平台提交路径，再按测评编号反查系统类型/版本后逐条保存草稿。目录规范：<分类>/<模块>/<套件>.txt + <套件>-豁免材料.zip + evidence/。"), (0, react.createElement)("div", { className: "oh-xts__grid" }, field({
    		id: "oh-xts-assessment",
    		label: "测评编号（豁免）",
    		value: values.waiverAssessmentNumber,
    		placeholder: "例如 OHC007500008641",
    		disabled: busy,
    		onChange: (value) => props.onChange("waiverAssessmentNumber", value)
    	}), field({
    		id: "oh-xts-waiver-path",
    		label: "豁免资料路径",
    		wide: true,
    		value: values.waiverPath,
    		placeholder: "目录或单个 .txt，例如 D:\\ohos\\XTS6.1\\DHong\\DH-76AM-HS26A\\exemption",
    		hint: "支持 Acts / ActsValidator / Hats / Dcts / Ssts 目录（HATS、DCTS、SSTS 已预留检测）。",
    		disabled: busy,
    		onChange: (value) => props.onChange("waiverPath", value)
    	})), (0, react.createElement)("div", { className: "oh-xts__actions" }, (0, react.createElement)("button", {
    		type: "button",
    		className: "oh-xts__btn",
    		onClick: props.onScan,
    		disabled: busy || scanning
    	}, scanning ? "识别中…" : "识别目录"), (0, react.createElement)("button", {
    		type: "button",
    		className: "oh-xts__btn",
    		onClick: props.onWaiverPreflight,
    		disabled: busy || scanning
    	}, "豁免资料预检"), (0, react.createElement)("button", {
    		type: "button",
    		className: "oh-xts__btn oh-xts__btn--primary",
    		onClick: props.onSaveWaiverDraft,
    		disabled: busy || scanning
    	}, busy ? "处理中…" : "保存豁免草稿")), (0, react.createElement)("p", { className: "oh-xts__note" }, "豁免资料只保存草稿，不会提交；批次中任一条失败会停止后续创建。镜像上传暂未启用。"), scanning ? (0, react.createElement)("div", { className: "oh-xts__panel" }, (0, react.createElement)("div", { className: "oh-xts__progress-top" }, (0, react.createElement)("span", null, "正在识别豁免资料…"))) : null, scan ? scanPanel(scan) : (0, react.createElement)("p", { className: "oh-xts__empty" }, "还没有识别结果：填好路径后点「识别目录」，可预览每份报告的测试套分类与提交路径。")), showProgress ? progressPanel(busy, result, percent, stage, detail) : null, batchPanel(batch, batchItems, batchTitle, batchCompleted, batchTotal), result && messages ? (0, react.createElement)("div", {
    		className: `oh-xts__status oh-xts__status--${result.ok ? "ok" : "error"}`,
    		role: "status"
    	}, messages) : null, metaLines.length > 0 ? (0, react.createElement)("div", {
    		className: "oh-xts__status",
    		role: "status"
    	}, metaLines.join(" · ")) : null, props.settingsLoaded ? null : (0, react.createElement)("div", {
    		className: "oh-xts__status oh-xts__status--error",
    		role: "status"
    	}, "读不到插件设置（Host 路由不可达）；保存与预检会失败。请确认 DSH 宿主已加载本插件。"));
    }
    //#endregion
    //#region src/client.tsx
    const DEFAULT_PHONE = "13950182204";
    const DEFAULT_EMAIL = "102438@dnake.com";
    const EMPTY_VALUES = {
    	username: "",
    	password: "",
    	workbookPath: "",
    	contactPhone: DEFAULT_PHONE,
    	contactEmail: DEFAULT_EMAIL,
    	waiverPath: "",
    	waiverAssessmentNumber: ""
    };
    async function request(path, method, body) {
    	try {
    		return await (await fetch(`/api/ohos-xts-auto-reporter/${path}`, {
    			method,
    			headers: body ? { "content-type": "application/json" } : void 0,
    			body: body ? JSON.stringify(body) : void 0
    		})).json();
    	} catch {
    		return {
    			ok: false,
    			message: "无法连接 DSH Host。"
    		};
    	}
    }
    function displayValue(value) {
    	return typeof value === "string" ? value : "";
    }
    /**
    * XTS 报告上传卡片。
    *
    * 数据面全部走本插件自己的 Host 路由（`/api/ohos-xts-auto-reporter/*`），
    * **不用 `ctx.settingsScope`**：该服务只存在于 DSH 0.1.x，0.2.0-rc.2（DSH Desktop）
    * 的浏览器半区已无此服务，注入它会让整个卡片永不挂载。
    * 视觉层拆在 `settings-view.ts`（纯 props），这里只负责状态、轮询与请求。
    */
    function ReporterSettingsCard() {
    	const [values, setValues] = (0, react.useState)(EMPTY_VALUES);
    	const [hasPassword, setHasPassword] = (0, react.useState)(false);
    	const [busy, setBusy] = (0, react.useState)(false);
    	const [scanning, setScanning] = (0, react.useState)(false);
    	const [result, setResult] = (0, react.useState)(null);
    	const [hostState, setHostState] = (0, react.useState)(null);
    	const [scan, setScan] = (0, react.useState)(null);
    	const [settingsLoaded, setSettingsLoaded] = (0, react.useState)(false);
    	(0, react.useEffect)(() => {
    		let active = true;
    		(async () => {
    			const response = await request("settings", "GET");
    			if (!active) return;
    			const value = response.settings ?? {};
    			setValues((previous) => ({
    				...previous,
    				username: displayValue(value.username),
    				password: "",
    				workbookPath: displayValue(value.workbookPath),
    				contactPhone: displayValue(value.contactPhone) || DEFAULT_PHONE,
    				contactEmail: displayValue(value.contactEmail) || DEFAULT_EMAIL,
    				waiverPath: displayValue(value.waiverPath),
    				waiverAssessmentNumber: displayValue(value.waiverAssessmentNumber)
    			}));
    			setHasPassword(response.hasPassword === true);
    			setSettingsLoaded(response.ok);
    		})();
    		return () => {
    			active = false;
    		};
    	}, []);
    	(0, react.useEffect)(() => {
    		let active = true;
    		const poll = async () => {
    			const response = await request("status", "GET");
    			if (active) setHostState(response);
    		};
    		poll();
    		const timer = window.setInterval(() => {
    			poll();
    		}, 2500);
    		return () => {
    			active = false;
    			window.clearInterval(timer);
    		};
    	}, []);
    	function onChange(field, value) {
    		setValues((previous) => ({
    			...previous,
    			[field]: value
    		}));
    	}
    	async function saveSettings() {
    		const response = await request("settings", "POST", {
    			username: values.username.trim(),
    			workbookPath: values.workbookPath.trim(),
    			mirrorPath: "",
    			contactPhone: values.contactPhone.trim() || DEFAULT_PHONE,
    			contactEmail: values.contactEmail.trim() || DEFAULT_EMAIL,
    			waiverPath: values.waiverPath.trim(),
    			waiverAssessmentNumber: values.waiverAssessmentNumber.trim(),
    			...values.password ? { password: values.password } : {}
    		});
    		if (!response.ok) {
    			setResult({
    				ok: false,
    				message: response.message || "设置保存失败。"
    			});
    			return false;
    		}
    		if (values.password) {
    			setHasPassword(true);
    			setValues((previous) => ({
    				...previous,
    				password: ""
    			}));
    		}
    		return true;
    	}
    	async function runScan() {
    		setScanning(true);
    		setResult(null);
    		const response = await request("waiver/scan", "POST", { waiverPath: values.waiverPath.trim() });
    		setScan(response);
    		setScanning(false);
    	}
    	async function run(action, body) {
    		setBusy(true);
    		setResult(null);
    		if (await saveSettings()) setResult(await request(action, "POST", body));
    		setBusy(false);
    	}
    	return (0, react.createElement)(SettingsCardView, {
    		values,
    		hasPassword,
    		busy,
    		scanning,
    		settingsLoaded,
    		result,
    		state: hostState?.state,
    		scan,
    		onChange,
    		onPreflight: () => {
    			run("preflight", { workbookPath: values.workbookPath.trim() });
    		},
    		onSaveReport: () => {
    			run("save", { workbookPath: values.workbookPath.trim() });
    		},
    		onWaiverPreflight: () => {
    			run("waiver/preflight", {
    				waiverPath: values.waiverPath.trim(),
    				waiverAssessmentNumber: values.waiverAssessmentNumber.trim()
    			});
    		},
    		onSaveWaiverDraft: () => {
    			run("waiver/save", {
    				waiverPath: values.waiverPath.trim(),
    				waiverAssessmentNumber: values.waiverAssessmentNumber.trim()
    			});
    		},
    		onScan: () => {
    			runScan();
    		}
    	});
    }
    /**
    * 必需注入：只要槽宿主。**不要加 `settingsScope`**——0.2.0-rc.2 的浏览器半区没有该服务，
    * 写进必需注入会让整个卡片（乃至浏览器半区）永不 apply。
    * `locale` 也省略：本卡片的中文文案是字面量，不依赖字典。
    */
    const inject = ["slots"];
    function apply(ctx) {
    	try {
    		ctx.slots.inject("settings.section", () => {
    			const unregister = ctx.slots.register({
    				name: "settings.section",
    				id: "ohos-xts-auto-reporter",
    				order: 35,
    				label: () => "XTS报告上传"
    			}, ReporterSettingsCard);
    			return () => unregister();
    		});
    	} catch (error) {
    		console.warn("[ohos-xts-auto-reporter] settings section mount failed:", error);
    	}
    }
    //#endregion
    exports.ReporterSettingsCard = ReporterSettingsCard;
    exports.apply = apply;
    exports.inject = inject;
    
    //# sourceMappingURL=client.cjs.map
		return module.exports;
	},
});
