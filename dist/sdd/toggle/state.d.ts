export interface SddToggleState {
    enabled: boolean;
    changed_at: string;
}
export declare function getToggleState(projectDir: string): SddToggleState;
export declare function setToggleState(projectDir: string, enabled: boolean): SddToggleState;
export declare function isSddEnabled(projectDir: string): boolean;
