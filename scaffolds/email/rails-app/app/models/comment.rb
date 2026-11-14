class Comment < ApplicationRecord
  belongs_to :task
  belongs_to :author, class_name: "User"

  validates :body, presence: true
end
