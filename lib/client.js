window.__ModuleLoader__.load({
	id: 'ohos-xts-auto-reporter',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    //#region src/client.tsx
    const DEFAULT_PHONE = "13950182204";
    const DEFAULT_EMAIL = "102438@dnake.com";
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
    function inputStyle() {
    	return {
    		width: "100%",
    		boxSizing: "border-box",
    		minHeight: "38px",
    		padding: "8px 11px",
    		border: "1px solid var(--dsw-color-border, #cbd5e1)",
    		borderRadius: "6px",
    		background: "var(--dsw-color-input, transparent)",
    		color: "inherit"
    	};
    }
    function labelStyle() {
    	return {
    		display: "grid",
    		gap: "6px",
    		margin: 0,
    		minWidth: 0,
    		fontSize: "13px"
    	};
    }
    function buttonStyle(primary = false) {
    	return {
    		border: `1px solid ${primary ? "var(--dsw-color-primary, #2563eb)" : "var(--dsw-color-border, #cbd5e1)"}`,
    		borderRadius: "6px",
    		minHeight: "38px",
    		padding: "7px 13px",
    		cursor: "pointer",
    		color: primary ? "#fff" : "inherit",
    		background: primary ? "var(--dsw-color-primary, #2563eb)" : "transparent"
    	};
    }
    /**
    * XTS 报告上传卡片。
    *
    * 数据面全部走本插件自己的 Host 路由（`/api/ohos-xts-auto-reporter/settings`），
    * **不用 `ctx.settingsScope`**：该服务只存在于 DSH 0.1.x，0.2.0-rc.2（DSH Desktop）
    * 的浏览器半区已无此服务，注入它会让整个卡片永不挂载。
    * 组件不再接收任何注入 props，注册时也无需 `inject`。
    */
    function ReporterSettingsCard() {
    	const [username, setUsername] = (0, react.useState)("");
    	const [password, setPassword] = (0, react.useState)("");
    	const [hasPassword, setHasPassword] = (0, react.useState)(false);
    	const [workbookPath, setWorkbookPath] = (0, react.useState)("");
    	const [mirrorPath] = (0, react.useState)("");
    	const [contactPhone, setContactPhone] = (0, react.useState)(DEFAULT_PHONE);
    	const [contactEmail, setContactEmail] = (0, react.useState)(DEFAULT_EMAIL);
    	const [waiverPath, setWaiverPath] = (0, react.useState)("");
    	const [waiverAssessmentNumber, setWaiverAssessmentNumber] = (0, react.useState)("");
    	const [waiverTestCategory, setWaiverTestCategory] = (0, react.useState)("ACTS-Validator");
    	const [busy, setBusy] = (0, react.useState)(false);
    	const [result, setResult] = (0, react.useState)(null);
    	const [hostState, setHostState] = (0, react.useState)(null);
    	const [settingsLoaded, setSettingsLoaded] = (0, react.useState)(false);
    	(0, react.useEffect)(() => {
    		let active = true;
    		(async () => {
    			const response = await request("settings", "GET");
    			if (!active) return;
    			const value = response.settings ?? {};
    			setUsername(displayValue(value.username));
    			setWorkbookPath(displayValue(value.workbookPath));
    			if (value.contactPhone) setContactPhone(displayValue(value.contactPhone));
    			if (value.contactEmail) setContactEmail(displayValue(value.contactEmail));
    			setWaiverPath(displayValue(value.waiverPath));
    			setWaiverAssessmentNumber(displayValue(value.waiverAssessmentNumber));
    			if (value.waiverTestCategory) setWaiverTestCategory(displayValue(value.waiverTestCategory));
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
    	const summary = (0, react.useMemo)(() => hostState?.state, [hostState]);
    	const displayState = result && !summary?.finishedAt ? {
    		...summary ?? { phase: "idle" },
    		finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    		ok: result.ok,
    		message: result.message,
    		batch: result.batch
    	} : summary;
    	const operation = result?.summary ?? summary?.summary;
    	const progress = displayState?.progress ?? summary?.progress;
    	const progressPercent = Number.isFinite(Number(progress?.percent)) ? Math.max(0, Math.min(100, Number(progress?.percent))) : void 0;
    	const progressStage = displayValue(progress?.stage);
    	const progressDetail = displayValue(progress?.detail);
    	const batch = displayState?.batch ?? summary?.batch ?? result?.batch;
    	const batchMode = displayValue(batch?.mode);
    	const batchTitle = displayValue(displayState?.kind) === "waiver" ? "批量豁免草稿进度" : "批量评测进度";
    	const batchItems = Array.isArray(batch?.items) ? batch.items : [];
    	const batchTaskCount = Number.isFinite(Number(batch?.taskCount)) ? Number(batch?.taskCount) : batchItems.filter((item) => item.taskIndex).length;
    	const batchSkippedCount = Number.isFinite(Number(batch?.skippedCount)) ? Number(batch?.skippedCount) : batchItems.filter((item) => displayValue(item.status) === "skipped").length;
    	const batchCompletedCount = batchItems.filter((item) => [
    		"saved",
    		"skipped",
    		"blocked",
    		"retryable"
    	].includes(displayValue(item.status))).length;
    	const firstResult = (Array.isArray(operation?.results) ? operation.results : [])[0];
    	const attachments = firstResult?.attachments;
    	async function saveSettings() {
    		const response = await request("settings", "POST", {
    			username: username.trim(),
    			workbookPath: workbookPath.trim(),
    			mirrorPath: "",
    			contactPhone: contactPhone.trim() || DEFAULT_PHONE,
    			contactEmail: contactEmail.trim() || DEFAULT_EMAIL,
    			waiverPath: waiverPath.trim(),
    			waiverAssessmentNumber: waiverAssessmentNumber.trim(),
    			waiverTestCategory: waiverTestCategory.trim() || "ACTS-Validator",
    			...password ? { password } : {}
    		});
    		if (!response.ok) {
    			setResult({
    				ok: false,
    				message: response.message || "设置保存失败。"
    			});
    			return false;
    		}
    		if (password) setHasPassword(true);
    		setPassword("");
    		return true;
    	}
    	async function preflight() {
    		setBusy(true);
    		setResult(null);
    		if (await saveSettings()) setResult(await request("preflight", "POST", { workbookPath: workbookPath.trim() }));
    		setBusy(false);
    	}
    	async function saveDraft() {
    		setBusy(true);
    		setResult(null);
    		if (await saveSettings()) setResult(await request("save", "POST", { workbookPath: workbookPath.trim() }));
    		setBusy(false);
    	}
    	async function waiverPreflight() {
    		setBusy(true);
    		setResult(null);
    		if (await saveSettings()) setResult(await request("waiver/preflight", "POST", {
    			waiverPath: waiverPath.trim(),
    			waiverAssessmentNumber: waiverAssessmentNumber.trim(),
    			waiverTestCategory: waiverTestCategory.trim()
    		}));
    		setBusy(false);
    	}
    	async function saveWaiverDraft() {
    		setBusy(true);
    		setResult(null);
    		if (await saveSettings()) setResult(await request("waiver/save", "POST", {
    			waiverPath: waiverPath.trim(),
    			waiverAssessmentNumber: waiverAssessmentNumber.trim(),
    			waiverTestCategory: waiverTestCategory.trim()
    		}));
    		setBusy(false);
    	}
    	const onText = (setter) => (event) => setter(event.target.value);
    	const gridStyle = {
    		display: "grid",
    		gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    		gap: "12px 14px",
    		alignItems: "start"
    	};
    	const fullWidthStyle = {
    		...labelStyle(),
    		gridColumn: "1 / -1"
    	};
    	const showProgress = progressPercent !== void 0 && (busy || displayState?.phase !== "idle" || Boolean(displayState?.finishedAt) || Boolean(result));
    	return (0, react.createElement)("section", { style: {
    		padding: "16px",
    		border: "1px solid var(--dsw-color-border, #cbd5e1)",
    		borderRadius: "8px",
    		marginBottom: "12px",
    		maxWidth: "760px",
    		boxSizing: "border-box"
    	} }, (0, react.createElement)("div", { style: {
    		display: "flex",
    		justifyContent: "space-between",
    		alignItems: "baseline",
    		gap: "10px",
    		marginBottom: "10px"
    	} }, (0, react.createElement)("strong", { style: { fontSize: "15px" } }, "OpenHarmony XTS 自动上报"), (0, react.createElement)("span", { style: {
    		fontSize: "12px",
    		opacity: .72
    	} }, "第二阶段资料 / 豁免草稿")), (0, react.createElement)("div", { style: gridStyle }, (0, react.createElement)("label", { style: labelStyle() }, "账号", (0, react.createElement)("input", {
    		type: "text",
    		autoComplete: "username",
    		value: username,
    		onChange: onText(setUsername),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: labelStyle() }, "密码", (0, react.createElement)("input", {
    		type: "password",
    		autoComplete: "current-password",
    		value: password,
    		placeholder: "留空使用已保存密码或环境变量",
    		onChange: onText(setPassword),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: fullWidthStyle }, "Excel 文件或批量目录", (0, react.createElement)("input", {
    		type: "text",
    		value: workbookPath,
    		placeholder: "单个 Excel 或目录，例如 D:\\ohos\\XTS6.1\\DHong",
    		onChange: onText(setWorkbookPath),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: fullWidthStyle }, "镜像固件路径（预留）", (0, react.createElement)("input", {
    		type: "text",
    		value: mirrorPath,
    		readOnly: true,
    		placeholder: "未来固件自动上传，当前留空",
    		disabled: true,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: labelStyle() }, "企业联系电话", (0, react.createElement)("input", {
    		type: "tel",
    		value: contactPhone,
    		onChange: onText(setContactPhone),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: labelStyle() }, "企业邮箱", (0, react.createElement)("input", {
    		type: "email",
    		value: contactEmail,
    		onChange: onText(setContactEmail),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("div", { style: {
    		...fullWidthStyle,
    		borderTop: "1px solid var(--dsw-color-border, #cbd5e1)",
    		paddingTop: "12px",
    		marginTop: "2px"
    	} }, (0, react.createElement)("div", { style: {
    		fontSize: "13px",
    		fontWeight: 600
    	} }, "豁免资料（只保存草稿，绝不提交）"), (0, react.createElement)("span", { style: {
    		fontSize: "12px",
    		opacity: .7
    	} }, "从指定路径读取 .txt 豁免报告，按测评编号反查操作系统类型/版本后逐条保存草稿。")), (0, react.createElement)("label", { style: labelStyle() }, "测评编号（豁免）", (0, react.createElement)("input", {
    		type: "text",
    		value: waiverAssessmentNumber,
    		placeholder: "例如 OHC007500008641",
    		onChange: onText(setWaiverAssessmentNumber),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: labelStyle() }, "豁免资料路径", (0, react.createElement)("input", {
    		type: "text",
    		value: waiverPath,
    		placeholder: "目录或单个 .txt，例如 D:\\ohos\\XTS6.1\\DHong\\DH-76AM-KS11C\\exemption",
    		onChange: onText(setWaiverPath),
    		disabled: busy,
    		style: inputStyle()
    	})), (0, react.createElement)("label", { style: labelStyle() }, "测试套分类", (0, react.createElement)("input", {
    		type: "text",
    		value: waiverTestCategory,
    		placeholder: "ACTS / ACTS-Validator / HATS / DCTS / SSTS",
    		onChange: onText(setWaiverTestCategory),
    		disabled: busy,
    		style: inputStyle()
    	}))), (0, react.createElement)("div", { style: {
    		display: "flex",
    		gap: "8px",
    		flexWrap: "wrap",
    		marginTop: "16px"
    	} }, (0, react.createElement)("button", {
    		type: "button",
    		onClick: () => {
    			preflight();
    		},
    		disabled: busy,
    		style: buttonStyle(false)
    	}, "预检"), (0, react.createElement)("button", {
    		type: "button",
    		onClick: () => {
    			saveDraft();
    		},
    		disabled: busy,
    		style: buttonStyle(true)
    	}, busy ? "处理中…" : "评测资料提交")), (0, react.createElement)("div", { style: {
    		display: "flex",
    		gap: "8px",
    		flexWrap: "wrap",
    		marginTop: "8px"
    	} }, (0, react.createElement)("button", {
    		type: "button",
    		onClick: () => {
    			waiverPreflight();
    		},
    		disabled: busy,
    		style: buttonStyle(false)
    	}, "豁免资料预检"), (0, react.createElement)("button", {
    		type: "button",
    		onClick: () => {
    			saveWaiverDraft();
    		},
    		disabled: busy,
    		style: buttonStyle(true)
    	}, busy ? "处理中…" : "保存豁免草稿")), (0, react.createElement)("p", { style: {
    		fontSize: "12px",
    		lineHeight: 1.5,
    		opacity: .68,
    		margin: "12px 0 0"
    	} }, "镜像上传暂未启用；豁免资料只保存草稿、绝不提交；批次中任一条失败会停止后续创建。"), showProgress ? (0, react.createElement)("div", { style: { marginTop: "14px" } }, (0, react.createElement)("div", { style: {
    		display: "flex",
    		justifyContent: "space-between",
    		alignItems: "baseline",
    		gap: "12px",
    		marginBottom: "6px",
    		fontSize: "12px"
    	} }, (0, react.createElement)("span", null, progressStage || (busy ? "处理中" : "处理状态")), (0, react.createElement)("strong", null, `${Math.round(progressPercent)}%`)), (0, react.createElement)("div", {
    		role: "progressbar",
    		"aria-label": "XTS 报告上传进度",
    		"aria-valuemin": 0,
    		"aria-valuemax": 100,
    		"aria-valuenow": Math.round(progressPercent),
    		style: {
    			height: "8px",
    			overflow: "hidden",
    			borderRadius: "4px",
    			background: "var(--dsw-color-fill-secondary, rgba(127, 127, 127, 0.22))"
    		}
    	}, (0, react.createElement)("div", { style: {
    		width: `${progressPercent}%`,
    		height: "100%",
    		borderRadius: "inherit",
    		background: result?.ok === false ? "var(--dsw-color-danger, #dc2626)" : "var(--dsw-color-primary, #2563eb)",
    		transition: "width 180ms ease-out"
    	} })), progressDetail ? (0, react.createElement)("div", { style: {
    		marginTop: "6px",
    		color: "var(--dsw-color-text-secondary, inherit)",
    		fontSize: "12px",
    		lineHeight: 1.5
    	} }, progressDetail) : null) : null, batchMode === "batch" && batchItems.length > 0 ? (0, react.createElement)("div", { style: { marginTop: "14px" } }, (0, react.createElement)("div", { style: {
    		display: "flex",
    		justifyContent: "space-between",
    		alignItems: "baseline",
    		gap: "12px",
    		marginBottom: "8px",
    		fontSize: "12px"
    	} }, (0, react.createElement)("strong", null, `${batchTitle}（${batchCompletedCount}/${batchTaskCount + batchSkippedCount}）`), (0, react.createElement)("span", { style: {
    		maxWidth: "50%",
    		minWidth: 0,
    		overflowWrap: "anywhere",
    		textAlign: "right",
    		opacity: .72
    	} }, batch?.rootPath ? displayValue(batch.rootPath) : "")), (0, react.createElement)("div", { style: {
    		display: "grid",
    		gap: "8px"
    	} }, batchItems.map((item, index) => {
    		const itemPercent = Number.isFinite(Number(item.percent)) ? Math.max(0, Math.min(100, Number(item.percent))) : 0;
    		const itemStatus = displayValue(item.status) || "pending";
    		const itemName = displayValue(item.name) || displayValue(item.directory) || `评测 ${index + 1}`;
    		return (0, react.createElement)("div", {
    			key: `${displayValue(item.directory)}-${String(item.taskIndex ?? index)}`,
    			style: {
    				padding: "8px 10px",
    				border: "1px solid var(--dsw-color-border, #cbd5e1)",
    				borderRadius: "6px"
    			}
    		}, (0, react.createElement)("div", { style: {
    			display: "flex",
    			justifyContent: "space-between",
    			gap: "10px",
    			fontSize: "12px"
    		} }, (0, react.createElement)("span", { style: {
    			minWidth: 0,
    			overflowWrap: "anywhere"
    		} }, itemName), (0, react.createElement)("span", null, `${Math.round(itemPercent)}%`)), (0, react.createElement)("div", {
    			role: "progressbar",
    			"aria-label": `${itemName} 评测进度`,
    			"aria-valuemin": 0,
    			"aria-valuemax": 100,
    			"aria-valuenow": Math.round(itemPercent),
    			style: {
    				height: "6px",
    				marginTop: "6px",
    				overflow: "hidden",
    				borderRadius: "3px",
    				background: "var(--dsw-color-fill-secondary, rgba(127, 127, 127, 0.22))"
    			}
    		}, (0, react.createElement)("div", { style: {
    			width: `${itemPercent}%`,
    			height: "100%",
    			borderRadius: "inherit",
    			background: ["blocked", "retryable"].includes(itemStatus) ? "var(--dsw-color-danger, #dc2626)" : "var(--dsw-color-primary, #2563eb)",
    			transition: "width 180ms ease-out"
    		} })), (0, react.createElement)("div", { style: {
    			marginTop: "5px",
    			fontSize: "12px",
    			lineHeight: 1.45,
    			color: ["blocked", "retryable"].includes(itemStatus) ? "var(--dsw-color-danger, #b91c1c)" : "var(--dsw-color-text-secondary, inherit)"
    		} }, `${displayValue(item.stage) || itemStatus}${item.detail ? `：${displayValue(item.detail)}` : ""}`), item.assessmentNumber ? (0, react.createElement)("div", { style: {
    			marginTop: "3px",
    			fontSize: "12px"
    		} }, `测评编号：${displayValue(item.assessmentNumber)}`) : null);
    	}))) : null, result ? (0, react.createElement)("div", {
    		role: "status",
    		style: {
    			marginTop: "10px",
    			color: result.ok ? "#15803d" : "#b91c1c",
    			whiteSpace: "pre-wrap",
    			fontSize: "13px"
    		}
    	}, result.ok ? result.message || "操作成功。" : [result.message, ...result.errors ?? []].filter(Boolean).join("\n")) : null, displayState !== void 0 && (displayState.phase !== "idle" || displayState.finishedAt) ? (0, react.createElement)("div", {
    		role: "status",
    		style: {
    			marginTop: "8px",
    			fontSize: "12px",
    			lineHeight: 1.6
    		}
    	}, `Host 状态：${String(displayState.phase)}${displayState.message ? `，${String(displayState.message)}` : ""}`, firstResult?.applicationId ? (0, react.createElement)("div", null, `申请标识：${String(firstResult.applicationId)}`) : null, firstResult?.assessmentNumber ? (0, react.createElement)("div", null, `测评编号：${String(firstResult.assessmentNumber)}`) : null, firstResult?.status ? (0, react.createElement)("div", null, `处理结果：${String(firstResult.status)}`) : null, attachments?.mirror?.fileName ? (0, react.createElement)("div", null, `镜像：${String(attachments.mirror.fileName)}`) : null) : null, !settingsLoaded ? (0, react.createElement)("div", {
    		role: "status",
    		style: {
    			marginTop: "8px",
    			color: "#b45309",
    			fontSize: "12px"
    		}
    	}, "读不到插件设置（Host 路由不可达）；保存与预检会失败。请确认 DSH 宿主已加载本插件。") : null);
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
