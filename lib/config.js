import z from 'schemastery';
/** Settings namespace shared by the Host and browser halves. */
export const PHASE2_SETTINGS_NAMESPACE = 'ohos-xts-auto-reporter';
export const Phase2Settings = z.object({
    username: z.string().role('secret'),
    password: z.string().role('secret'),
    workbookPath: z.string(),
    selfCheckPath: z.string().default(''),
    reportPath: z.string().default(''),
    mirrorPath: z.string().default(''),
    contactPhone: z.string().default('13950182204'),
    contactEmail: z.string().default('102438@dnake.com'),
});
export const Config = z.object({
    enabledSkills: z.array(z.string()),
    phase2: Phase2Settings,
    settingsFile: z.string(),
});
