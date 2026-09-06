package account

import "fmt"

type Account struct { ID string }
func (a *Account) Load() { fmt.Println(a.ID) }
