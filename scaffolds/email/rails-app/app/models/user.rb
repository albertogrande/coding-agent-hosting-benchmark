class User < ApplicationRecord
  has_secure_password
  has_many :tasks, foreign_key: :owner_id, dependent: :destroy
  has_many :comments, foreign_key: :author_id, dependent: :destroy

  normalizes :email, with: ->(e) { e.strip.downcase }
  validates :name, presence: true
  validates :email, presence: true, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :password, length: { minimum: 8 }, allow_nil: true

  def activity_since(time)
    {
      created: tasks.where(created_at: time..).count,
      completed: tasks.where(done_at: time..).count,
      comments: comments.where(created_at: time..).count
    }
  end
end
