from dataclasses import dataclass
import json

@dataclass
class Account:
    id: str
    def load(self):
        return json.loads("{}")
