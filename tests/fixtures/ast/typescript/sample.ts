import { helper as aliased } from "./helper"
export interface Account { id: string }
export class AccountService {
  async load(): Promise<Account> { return aliased() }
}
export default AccountService
