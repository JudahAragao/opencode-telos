require "json"

module Billing
  class Account < Base
    include Trackable
    def load; end
  end
end
