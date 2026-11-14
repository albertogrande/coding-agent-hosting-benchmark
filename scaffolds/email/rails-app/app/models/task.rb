class Task < ApplicationRecord
  belongs_to :owner, class_name: "User"
  has_many :comments, dependent: :destroy

  validates :title, presence: true
end
